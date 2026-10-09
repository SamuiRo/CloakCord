# Next steps

Plan agreed on 2026-10-08. CloakCord becomes a source of Inemuri (a Discord
user-account reader), and the dead library is replaced by an own minimal
client. Known problems are in [ISSUES.md](ISSUES.md).

What CloakCord actually needs from Discord is small:

1. **Live events:** receive `MESSAGE_CREATE` from a set of channels.
2. **History scans, occasionally:** read older messages of a channel.

Everything else the library does (voice, interactions, relationships, guild
management, captcha, TOTP, remote auth, a full object cache) is unused.

## Decision: own client, not a fork, not Python

| Option | Verdict | Why |
|---|---|---|
| Fork and slim down `discord.js-selfbot-v13` | No | A full discord.js v13 fork: managers, structures, actions and the gateway are tightly coupled, so removing parts breaks imports and the cache object model stays. All protocol drift would still be ours to fix, inside a large foreign codebase. GPL-3.0 conflicts with Inemuri's MIT licence (ISSUES O2). The useful fix (`makeCache` limits) is already done. |
| Rewrite on the maintained Python library | No (as runtime) | A second runtime in a Node system: venv, separate deploy, tests and CI, and a mandatory process boundary with IPC. It has the same cache model to tune. Everything would be rewritten anyway. |
| Use the Python library as a **protocol reference** | Yes | It is actively maintained. When Discord changes what a user client must send (`IDENTIFY` properties, `X-Super-Properties`, client build number, capabilities), the change shows up there first. Take knowledge, not code. |
| **Own minimal Node client** | **Yes** | ~300–400 lines, no cache at all, so memory is flat by construction. Fits Inemuri's conventions (ESM, pure core with tests, thin I/O shell). MIT, written from protocol knowledge. |

## Step 1 — finish CloakCord 1.6.3 verification

- Run 1.6.3, read `watched` and `seen` in `[MEMSTAT]` (ISSUES O4, O5, O6).
- Clean the channel list of rows the account can no longer see.
- Exit criterion: `sent` grows with `matched` on real traffic, RSS flat.

## Step 2 — move into Inemuri on the current library

Goal: a working source inside Inemuri with no change in transport yet.

- `DiscordSelfSource` extends `BaseSourceAdapter` and runs the transport in a
  **supervised child process** (`child_process.fork`) with its own
  `--max-old-space-size` and an RSS watchdog that restarts only the child.
  The main process holds the Telegram session, discordapp and TheFlow; a
  crash or leak in the transport must not take them down.
- Child -> parent over IPC: normalized messages only (plain objects, no
  library classes). Parent publishes them to `EventBus`; filtering, routing,
  dedup and delivery are Inemuri's (`MessageFilter`, routing, TheFlow).
- Configuration moves to `sources.json` (git-ignored, with a neutral
  `*.sample.json`). Map only used fields: channel id, guild id/name,
  keywords (empty = all), suppress embeds. Webhook delivery moves to
  Inemuri's Discord delivery; CloakCord's `Channel` table and webhook code
  are dropped.
- Secrets: the user token goes into Inemuri's `.env` through
  `src/config/app.config.js` and `.env.example`, like every other variable.
- The transport interface is narrow from day one, so step 3 swaps only the
  child's internals:

  ```js
  // child process -> parent
  { type: "message", message: { id, channelId, guildId, authorId, authorName,
    content, embeds: [{ title, description, fields }], attachments: [{ url, contentType, name }],
    createdAt } }
  { type: "status", state: "ready" | "resumed" | "reconnecting" | "fatal", detail }

  // parent -> child
  { type: "watch", channelIds: [...] }
  { type: "history", requestId, channelId, before, limit }
  ```

- Exit criterion: same `seen` / `matched` as CloakCord on the same channels
  for a few days; CloakCord is switched off.

## Step 3 — own minimal client

Lives in Inemuri (for example `src/sources/discordself/`), behind the step 2
interface.

### Gateway (~200–250 lines)

- `GET /gateway` (or a cached URL), connect with `ws`, `v=10&encoding=json`.
  Optional `zlib-stream` compression later; the `READY` payload of ~90 guilds
  is large but arrives once.
- `HELLO` (op 10) -> heartbeat every `heartbeat_interval` with initial jitter;
  missed `HEARTBEAT_ACK` (op 11) -> close and resume.
- `IDENTIFY` (op 2) with user-client `properties` and `capabilities` (take
  current values from the reference library; keep them in config, not code).
- Keep `session_id`, `resume_gateway_url` and the last sequence `s`;
  on disconnect `RESUME` (op 6); on `INVALID_SESSION` (op 9) re-identify
  after a random 1–5 s; on `RECONNECT` (op 7) resume.
- Reconnect with exponential backoff and a cap. Close codes that mean "do not
  retry" (authentication failed, invalid intents/shard) stop the child with a
  `fatal` status; the parent alerts instead of looping.
- From `READY` keep only what the source needs: own user id and, per guild,
  the set of visible channel ids (for `watched=visible/total`). Drop the rest
  of the payload immediately.
- `DISPATCH` (op 0): handle `MESSAGE_CREATE` for watched channels only,
  optionally `MESSAGE_UPDATE`. Everything else is ignored without parsing
  beyond the event name.

### REST history scanner (~100–150 lines)

- `GET /channels/{id}/messages?before={id}&limit=100`, paginate backwards
  until a stop condition (message id or date, or a page budget).
- Same client headers as the gateway identity (user agent, super properties).
- Rate limits: honour `429` `retry_after` and the `X-RateLimit-*` headers;
  one request in flight per account.
- **Slow by policy, not by luck.** Passive gateway traffic looks like an open
  client; bulk history scrolling from a user account is the pattern
  anti-abuse watches for. Pause between pages (configurable, seconds rather
  than milliseconds), a daily page budget per account, scans only for
  configured channels, never in parallel with a reconnect storm.

### Core and tests

Pure functions, tested with `node --test` (no network):

- `decideGatewayAction(state, packet)` -> heartbeat / identify / resume /
  reconnect / dispatch / fatal.
- `normalizeMessage(payload)` -> the plain message object above.
- `matchesKeywords(message, keywords)` over content **and** embed title,
  description and fields (fixes ISSUES O6); empty keywords = match all.
- `nextHistoryRequest(state)` and `parseRateLimit(headers, status)`.

The shell (socket, timers, HTTP, IPC) stays thin around them.

### Rollout

1. Run the new client in **shadow mode** in a second child process next to
   the library-based one: same channels, it only counts `seen` / `matched`
   and publishes nothing.
2. Compare counters for about a week (same messages, reconnects survived,
   RSS flat).
3. Switch the source to the new client, remove `discord.js-selfbot-v13` from
   dependencies.

Estimate: a few days for the client and its tests, about a week of shadow
running.

## Open questions

- Whether `MESSAGE_UPDATE` is needed (ISSUES O8) — decide at step 2.
- Which attachment and embed types should be forwarded (ISSUES O7).
- Whether history scans are triggered manually (CLI command) or on a
  schedule (cron); manual first is the safer default.
