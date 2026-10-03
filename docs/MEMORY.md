# Memory growth: investigation and fix

Status as of v1.6.1 (2026-10-03): root cause identified and fixed in code,
**not yet confirmed in production**. This document records what was found,
what was changed, and how to verify it. Update the "Verification log" section
with the outcome.

## Symptom

RSS grew steadily and relatively fast for the whole lifetime of the process.
Nothing in the application code helped (sweepers, manual sweeps, forced GC,
deep-cleaning objects, `WeakMap`s). Production ran under pm2 with
`--max-memory-restart 300M`, i.e. a periodic restart was the only working
"fix".

## Evidence: heap snapshots of 2025-08-07

The old monitor wrote five heap snapshots one minute apart
(`20:08`–`20:12` UTC, ~228 MB each). They were aggregated by constructor,
first vs last (4 minutes apart):

| Object | 20:08 | 20:12 | Delta |
|---|---:|---:|---:|
| `GuildMember` | 66 113 | 67 156 | **+1 043** |
| `User` | 47 749 | 48 538 | **+789** |
| `Message` | 627 | 682 | +55 |
| `TextChannel` | 11 552 | 11 553 | +1 |
| `ThreadChannel` | 3 635 | 3 635 | 0 |
| `Role` | 6 404 | 6 404 | 0 |
| `PermissionOverwrites` | 71 386 | 71 393 | +7 |
| `Guild` | 107 | 107 | 0 |
| `GuildEmoji` | 308 | 0 | -308 (see below) |

Total V8 self size was ~153 MB at the start of the window.

Reading:

- **Growth = guild member and user caches.** About 1 000 new members in 4
  minutes against only 55 new messages, so members came from events other
  than the watched messages (typing, presence, member updates, message
  authors, on all guilds).
- **Baseline = account size.** 107 guilds, ~11.5k channels, ~3.6k threads,
  ~71k permission overwrites, ~6.4k roles. This is loaded at `READY` and is
  static. It is not a leak.

The snapshots were deleted after this analysis: they contain the whole
process memory, including the account token and webhook tokens.

## Root cause

1. **The library ignores intents for user accounts.**
   `discord.js-selfbot-v13` hardcodes `this.options.intents = Intents.ALL`
   (`src/client/Client.js`). The `intents` list in our client options had no
   effect. Discord sends events from *every* guild the account is in.
2. **Unbounded caches.** The default `makeCache` limits only `MessageManager`
   (200 per channel) and threads. `GuildMemberManager` and `UserManager` are
   unlimited, so every member seen in any event stayed cached forever.
3. **Why the previous mitigations failed:**
   - No `guildMembers` sweeper was configured, and that was the cache that grew.
   - The `users` sweeper could not free anything: every `GuildMember` holds a
     reference to its `User`, so a user removed from `client.users.cache`
     stays alive.
   - `manualSweep()` replaced `client.emojis.cache` with a filtered copy. That
     breaks the cache (`GuildEmoji` 308 -> 0) and does not free memory.
   - `deepCleanObject`, `WeakMap`s and `global.gc()` only touched our own
     short-lived objects, not the library caches.
4. **The monitor made it worse.** It used `heapUsed / heapTotal` as the leak
   metric. V8 keeps `heapTotal` close to `heapUsed`, so the ratio is almost
   always high. Above 85% it wrote a 228 MB heap snapshot every minute, which
   temporarily doubles process memory and fills the disk.

## Fix (v1.6.1)

`src/modules/discord/discord-user.js` limits the caches through `makeCache`
instead of sweepers:

| Cache | Limit |
|---|---|
| `GuildMemberManager`, `UserManager` | `maxSize: 1` + `keepOverLimit` for the account itself |
| `MessageManager`, `PresenceManager`, `VoiceStateManager`, `ReactionManager`, `ReactionUserManager`, `ThreadMemberManager`, `GuildBanManager`, `GuildInviteManager`, `StageInstanceManager` | `0` |
| Threads | library default (archived threads swept hourly) |

Why `maxSize: 1` and not `0`: `LimitedCollection.set()` returns immediately
when `maxSize === 0`, so `keepOverLimit` is never consulted and the account's
own member/user would not be kept either. With `1`, the cache holds the
account plus the latest entry. Offline test: 5 000 distinct users added, cache
size 2, own user kept.

Not limitable: `GuildManager`, `ChannelManager`, `GuildChannelManager`,
`RoleManager`, `PermissionOverwriteManager` (the library warns that overriding
them breaks functionality). The baseline can only be reduced by leaving guilds
the account does not need.

The handler no longer touches `message.member` or reaction data, so the
limits do not change forwarding behaviour.

### Forwarding bugs fixed in the same release

v1.6.0 forwarded nothing, independently of memory:

- Webhooks are stored as `id/token`, but `validateWebhookUrl` accepted only
  full `https://discord.com/...` URLs, so every target was rejected.
- `Channel.findOne({ raw: true })` returns SQLite JSON columns as strings, so
  `filter` was never an array and every message was dropped as "No keywords
  configured".
- `webhook.service` swallowed errors, so success counters were wrong.

Channels are now loaded once into memory and refreshed every 5 minutes.
Unwatched channels are skipped without logging.

## Verification procedure

Run **without** a pm2 memory limit, so a restart does not hide the trend:

```bash
pm2 start index.js --name cloakcord
```

Every 10 minutes the monitor logs one line:

```
[MEMSTAT] uptime=120m rss=210.4MB heap=150.2MB ext=3.1MB | guilds=107 channels=15188 members=214 users=2 msgs=0 | events=8123 matched=14 sent=14 errors=0
```

Collect it with:

```bash
pm2 logs cloakcord --lines 2000 | grep MEMSTAT
```

The same line goes to Telegram hourly, and an alert is sent when RSS exceeds
`MEMORY_ALERT_MB` (`.env`, default 400; at most once per hour).

Expected values:

| Field | Expected |
|---|---|
| `members` | about 2 per guild at most (own member + latest), so it should stay at or below ~2 × `guilds`, flat |
| `users` | 1–2, flat |
| `msgs` | 0 |
| `rss` | rises during the first hour (READY payload, JIT, V8 heap sizing), then a plateau |
| `sent` | grows with `matched` (forwarding works) |

**Success:** `rss` stays on a plateau for 24–48 h while caches stay small.

**If RSS still grows while caches are small**, there is a second leak outside
the caches. Next step: take a heap snapshot on demand with
`require("./src/modules/resource_manager/monitor").createHeapSnapshot()`
(two of them, an hour apart), compare by constructor, then delete the files.

**If `members` grows**, some code path bypasses the cache factory; find which
manager by checking its `cache.constructor.name` (should be
`LimitedCollection`).

## Library status

`discord.js-selfbot-v13`: GitHub repository archived (last push 2025-10-11),
npm package marked deprecated. Latest version 3.7.1, this project uses 3.7.0.
No upstream fixes will come.

Decision: do not fork or maintain it. It is a full discord.js v13 fork, and
CloakCord only needs two things: receiving gateway events
(`MESSAGE_CREATE`) and occasionally reading channel history
(`GET /channels/{id}/messages?before=`). Planned path: move CloakCord into
Inemuri as a source running in a supervised child process, then replace the
library with a minimal cache-less gateway + REST client behind the same
interface.

## Verification log

| Date | Version | Duration | RSS start -> end | Caches | Result |
|---|---|---|---|---|---|
| | 1.6.1 | | | | |
