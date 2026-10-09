# Known issues

Register of every known problem in CloakCord, fixed and open. Last review:
2026-10-08 (v1.6.3). The memory investigation has its own document,
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

## Open

| # | Severity | Problem | Notes / next action |
|---|---|---|---|
| O1 | critical | **The library is dead.** `discord.js-selfbot-v13`: GitHub repository archived (last push 2025-10-11), npm package deprecated, latest 3.7.1 (we use 3.7.0). No upstream fixes when Discord changes the user-client protocol. | Replace with an own minimal client: [NEXT_STEPS.md](NEXT_STEPS.md). Do not fork it (see O2). |
| O2 | high | **License: GPL-3.0.** The library is GPL-3.0; Inemuri is MIT and public. A modified fork vendored into Inemuri would put Inemuri under GPL. | The own client is written from protocol knowledge, not from copied library code. |
| O3 | critical | **Discord ToS.** Automating a user account ("self-bot") is against Discord's terms; the account can be banned without warning. | Use a dedicated secondary account, read-only. Never send from it — delivery stays on webhooks. Keep history scans slow (see NEXT_STEPS). |
| O4 | high | **Forwarding not yet confirmed after v1.6.3.** The 19 h run of v1.6.1 showed `matched=0 sent=0`. F9 explains the 9 forward-all channels; the 67 keyword channels are unexplained. | Run 1.6.3 and read `watched` / `seen` (see MEMORY.md, "Follow-up"). |
| O5 | high | **Stale channel list.** The account went from 107 to 92 guilds; the database references 70 guilds. Some configured channels may be unreachable. | `watched=X/76` will show how many. Remove or replace the dead rows. |
| O6 | high | **Text inside embeds is never matched.** Only `message.content` is checked. Bots and announcement feeds often post an empty `content` with the text in `embeds` (title, description, fields). Such messages are skipped as "no content" unless they have an image attachment. Possible cause of O4. | If `seen` grows but `matched` stays 0, check whether the sources post embeds. Matching should cover embed title, description and fields. |
| O7 | medium | **Only image attachments are forwarded.** Other files (video, documents) are dropped; source embeds and stickers are not forwarded either. | Decide what is needed when moving into Inemuri (its media resolver already handles this). |
| O8 | medium | **Edits and deletes are ignored.** `MESSAGE_UPDATE` is not handled, so a post that gets its keyword in an edit is never forwarded. No dedup either. | Inemuri's dedup and TheFlow cover this after the move. |
| O9 | medium | **Restart path reuses a destroyed client.** `index.js` `handleRestart()` calls `DiscordUser.shutdown()` (`client.destroy()`) and then `main()` again on the same `Client` instance. Untested; may fail to log in again. | In practice pm2 restarts the process. Make the restart path exit and let pm2 restart, or create a new client. |
| O10 | medium | **`upload.js` calls `notify` without importing it**, so a DB error during upload throws `ReferenceError`. It also only upserts: channels removed from `guild_whitelist.json` stay in the database. | Fix if `upload.js` stays; moot after the move (Inemuri seeds from `sources.json`). |
| O11 | low | **Unused fields and config.** `blacklist`, `replace`, `add_content`, `target_telegram`, `target_line`, `type` are stored but never used; `DISCORD_*_CHANNEL_WEBHOOK` env vars and an empty `src/modules/telegram/telegram.js` are leftovers; `sequelize-cli` is an unused dependency. | Drop during the move; map only the fields that are used. |
| O12 | low | **`sequelize.sync()` on every start, no migrations.** Harmless for one small table, but a schema change has no safe path. | Moot after the move (Inemuri has migrations). |
| O13 | low | **No tests, no lint.** The only checks are the offline smoke test used for 1.6.1/1.6.3. | The own client is built with `node --test` suites from the start (pure core). |
| O14 | low | **Notifications swallow errors.** `notify()` logs and continues; a broken Telegram token goes unnoticed except in logs. | Acceptable for alerts; Inemuri has its own delivery health. |
| O15 | low | **README token instructions.** README shows how to extract a user token from the browser console. Fine for a private repo; do not carry it into the public Inemuri repo. | Document the token as an `.env` secret only. |
