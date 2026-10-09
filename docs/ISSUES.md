# Known issues

Register of every known problem in CloakCord, fixed and open. Last review:
2026-10-09 (v1.6.4) — after the move into Inemuri (v4.61.0, NEXT_STEPS step
2). CloakCord is switched off; the open items below now concern the Inemuri
source (`src/sources/discord/`, `docs/DISCORD_SOURCE.md` there). The memory investigation has its own document,
[MEMORY.md](MEMORY.md); the plan for what comes next is in
[NEXT_STEPS.md](NEXT_STEPS.md).

Severity: **critical** (data loss, nothing works, account or secret at risk),
**high** (wrong behaviour in normal operation), **medium** (wrong in edge
cases, or a trap for the next change), **low** (cleanup).

## Fixed

| # | Severity | Problem | Fixed in |
|---|---|---|---|
| F1 | critical | **Memory grew without bound.** The library forces `Intents.ALL` for user accounts and never limits `GuildMemberManager` / `UserManager`, so every member seen in any event on any guild stayed cached. Sweepers could not help (each `GuildMember` holds its `User`). Production needed a pm2 restart at 300 MB. | 1.6.1, confirmed by a 19 h run on 2026-10-03 ([MEMORY.md](MEMORY.md)) |
| F2 | critical | **Nothing was forwarded in v1.6.0: webhook validation.** Webhooks are stored as `id/token`; `validateWebhookUrl` accepted only full `https://discord.com/...` URLs and rejected every target. | 1.6.1 |
| F3 | critical | **Nothing was forwarded in v1.6.0: JSON columns as strings.** `findOne({ raw: true })` returns SQLite JSON columns (`filter`, `target_discord`) as strings, so `filter` was never an array and every message was dropped as "No keywords configured". | 1.6.1 |
| F4 | high | **Webhook errors were swallowed.** `webhook.service` caught and logged, so callers counted failures as successes. It now throws with status and response body (never the URL, which contains the token). | 1.6.1 |
| F5 | high | **Monitor wrote 228 MB heap snapshots every minute.** It treated `heapUsed / heapTotal` (always high in V8) as a leak signal. Each snapshot doubled process memory while writing and contained the account token. Snapshots are now manual only; the metric is RSS. | 1.6.1 |
| F6 | medium | **`manualSweep` broke the emoji cache** by replacing `client.emojis.cache` with a filtered copy (`GuildEmoji` 308 -> 0). Removed. | 1.6.1 |
| F7 | medium | **Duplicate signal handlers.** `discord-user.js`, `monitor.js` and `index.js` each registered `SIGINT`/`SIGTERM`/`uncaughtException`; the first `process.exit` won. Only `index.js` handles them now. | 1.6.1 |
| F8 | medium | **One DB query and four log lines per message on all guilds.** ~8–10k events per hour went through `Channel.findOne` and `console.log`. Channels are now held in memory (refreshed every 5 min) and unwatched channels are skipped silently. | 1.6.1 |
| F9 | high | **Empty filter forwarded nothing.** The default filter `[""]` meant "forward everything" up to v1.5.3 (`includes("")` is true); v1.6.0 and v1.6.1 dropped empty keywords. 9 of 76 channels were affected. | 1.6.3 |
| F10 | medium | **No way to tell "channel unreachable" from "no keyword match".** `[MEMSTAT]` now shows `watched=visible/total` and `seen` (messages from watched channels before keyword filtering). | 1.6.3 |
| F11 | critical | **Heap snapshots with secrets on disk.** Five snapshots (~1.1 GB) held the account token and webhook tokens. Git-ignored, never committed. Deleted 2026-10-03 after analysis. | — |
| F12 | high | **Text inside embeds was never matched** (was O6). Only `message.content` was checked; bots and announcement feeds post an empty `content` with the text in `embeds`. Matching now covers content plus embed title, description and fields. | Inemuri v4.61.0 |
| F13 | medium | **Only image attachments were forwarded** (was O7). Videos and embed images are forwarded now (up to 4); documents and stickers are not, by decision. | Inemuri v4.61.0 |
| F14 | low | **README token instructions** (was O15) were not carried into the public Inemuri repo; there the token is only `DISCORD_USER_TOKEN` in `.env`. | Inemuri v4.61.0 |

## Open

| # | Severity | Problem | Notes / next action |
|---|---|---|---|
| O1 | critical | **The library is dead.** `discord.js-selfbot-v13`: GitHub repository archived (last push 2025-10-11), npm package deprecated, latest 3.7.1 (Inemuri pins 3.7.0 exactly). No upstream fixes when Discord changes the user-client protocol. | Now isolated in Inemuri's child process. Replace with an own minimal client: [NEXT_STEPS.md](NEXT_STEPS.md) step 3. Do not fork it (see O2). |
| O2 | high | **License: GPL-3.0.** The library is GPL-3.0; Inemuri is MIT and public. A modified fork vendored into Inemuri would put Inemuri under GPL. | Inemuri uses it as an npm dependency only, nothing copied or modified. The own client is written from protocol knowledge. |
| O3 | critical | **Discord ToS.** Automating a user account ("self-bot") is against Discord's terms; the account can be banned without warning. | Use a dedicated secondary account, read-only. Never send from it — delivery is Inemuri's bot. Keep history scans slow (see NEXT_STEPS). |
| O8 | medium | **Edits and deletes are ignored.** `MESSAGE_UPDATE` is not handled, so a post that gets its keyword in an edit is never forwarded. | Still true in Inemuri v4.61.0. TheFlow's dedup covers repeats for flow-enabled channels. |
| O16 | medium | **Not yet run against Discord.** The Inemuri source passed unit tests with a fake child and a real child with an empty token, nothing live. Forwarding was never confirmed in CloakCord either (was O4). | First live run in Inemuri: `[DISCORD] stats` with flat RSS, `members` ≤ ~2 per server, `watched` = total, `matched` > 0. |

## Closed by the move into Inemuri

Problems of CloakCord's own code and data, which Inemuri does not carry over.

| # | Problem | Why closed |
|---|---|---|
| O4 | Forwarding not confirmed after v1.6.3 | CloakCord is off; confirming moves to the Inemuri source (O16) |
| O5 | Stale channel list (107 → 92 guilds, 70 referenced) | The list is not migrated; channels are described anew. Inemuri lists invisible channels by name at startup |
| O9 | Restart path reuses a destroyed client | Inemuri restarts the whole child process, a new client each time |
| O10 | `upload.js` bugs, stale rows | Inemuri seeds from `sources.json` |
| O11 | Unused fields and config | Only channel id, name, keywords and destinations are used in Inemuri |
| O12 | `sequelize.sync()`, no migrations | Inemuri has migrations; the `discord` platform needed none |
| O13 | No tests, no lint | Inemuri's source has `node --test` suites for its pure core and the supervisor, and is linted in CI |
| O14 | Notifications swallow errors | Inemuri's logging, health and status board apply |
