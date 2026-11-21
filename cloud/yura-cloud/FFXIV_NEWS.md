# YURA Cloud: FFXIV Discord News

- Runs **once daily at 10:00 Europe/Warsaw**, with DST handled by the Worker. The existing per-minute cron is reused; no separate scheduled job, gateway connection or Desktop session.
- On initial deployment only, the first successful provisioning check runs at a quarter-hour boundary to create/find the Discord channel and establish source baselines (no historical news flood).
- Reuses `DISCORD_BOT_TOKEN` already configured for YURA Discord onboarding. The bot needs **View Channel / Send Messages**; if `#ffxiv-news` does not exist, also **Manage Channels**.
- Default guild comes from current Discord onboarding configuration, or the existing YURA Desktop schedule guild if onboarding is not configured.
- If `channelId` is blank the Worker finds a text channel named `ffxiv-news`, or creates it. Existing channels are never modified/deleted.
- Sources: official Lodestone News and Topics RSS (EU with NA fallback); actual stable Dalamud version from `goatcorp/dalamud-distrib/main/version` (do not substitute outdated GitHub Releases); weekly Fashion Report PNG from `https://fashionreportxiv.com/hint.png`.
- Fashion Report uses the SHA-256 of the real image to detect new guides, checking daily rather than blindly posting each Friday. Discord image URLs contain a short cache-busting digest. If the image fails validation, no fake Fashion Report is posted.
- Persistent deduplication: migration `0018_ffxiv_news_seen.sql`; first successful feed read records existing items without posting. Failed sources are retried on the next daily check. No arbitrary placeholder releases are published.
- Exactly **four permanent, editable Discord messages**, created in this order: (1) Current Event, (2) Fashion Report, (3) Latest Patch Notes, (4) Stable Dalamud. Each message has its own history thread. When an item is replaced or expires, its previous version is copied into its thread before the main message is edited. Discord has no native “move message” API.
- Fashion Report is considered expired at the next Tuesday 08:00 UTC weekly reset and will remain inactive until the source PNG hash changes. Events expire at their officially confirmed end timestamps; unsuccessful source requests do not clear a known current event. Patch Notes and Dalamud stay current until their source changes.
- Messages are edited **only on actual content changes**; daily 10:00 is a check, not an announcement. Archived threads auto-archive after 24h inactivity and are reopened only on a new archived entry. No daily "nothing new" posts.
- Migration from the old three-post layout attempts to copy bot-owned archived messages into the new corresponding history threads before removing the old bot-owned placeholders. If a thread contains discussion or cannot be copied safely, its old message is preserved for manual cleanup.
- Additional Discord bot permissions: **Create Public Threads**, **Send Messages in Threads** and **Read Message History** on the selected news channel. If the bot cannot create/write threads, the failure is recorded in the Cloud status; no fallback floods the main channel.
- Authenticated with the existing Worker Admin Key or Twitch broadcaster OAuth: `/api/admin/ffxiv-news`.
  - `GET` current switches, channel and last check / errors.
  - `PUT` JSON `{enabled,guildId,channelId,fashion,dalamud,lodestone}` (all fields optional).
  - `POST` JSON `{"action":"check"}` performs an immediate new-items-only check; `{"action":"test"}` sends exactly one test message. `{"action":"publish-latest"}` explicitly sends the current real Fashion Report + stable Dalamud + recent Lodestone posts once, even on a newly configured server.
- Desktop: Discord → GENERAL → FFXIV NEWS. Changes are stored in Cloud D1 across Desktop updates, not in local `settings.json`.

The feed titles are preserved as the official publishers wrote them; YURA's grouping and labels are in Polish. Unavailable source data is reported in Cloud diagnostics and never replaced with unverified news. GitHub Actions runs an optional live source smoke check with results visible in CI.
