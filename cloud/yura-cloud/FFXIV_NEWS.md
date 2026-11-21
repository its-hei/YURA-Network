# YURA Cloud: FFXIV Discord News

- Runs **once daily at 10:00 Europe/Warsaw**, with DST handled by the Worker. The existing per-minute cron is reused; no separate scheduled job, gateway connection or Desktop session.
- On initial deployment only, the first successful provisioning check runs at a quarter-hour boundary to create/find the Discord channel and establish source baselines (no historical news flood).
- Reuses `DISCORD_BOT_TOKEN` already configured for YURA Discord onboarding. The bot needs **View Channel / Send Messages**; if `#ffxiv-news` does not exist, also **Manage Channels**.
- Default guild comes from current Discord onboarding configuration, or the existing YURA Desktop schedule guild if onboarding is not configured.
- If `channelId` is blank the Worker finds a text channel named `ffxiv-news`, or creates it. Existing channels are never modified/deleted.
- Sources: official Lodestone News RSS, official Lodestone Topics RSS, GitHub stable releases for `goatcorp/Dalamud`. Friday includes a weekly Fashion Report link from `fashionreportxiv.com`; image is embedded only if the publisher exposes a directly usable image URL.
- Persistent deduplication: migration `0018_ffxiv_news_seen.sql`; first successful feed read records existing items without posting. Failed sources are retried on the next daily check. No arbitrary placeholder releases are published.
- Discord messages disable all mentions and use one compact digest; no routine "nothing new" messages.
- Authenticated with the existing Worker Admin Key or Twitch broadcaster OAuth: `/api/admin/ffxiv-news`.
  - `GET` current switches, channel and last check / errors.
  - `PUT` JSON `{enabled,guildId,channelId,fashion,dalamud,lodestone}` (all fields optional).
  - `POST` JSON `{"action":"check"}` performs an immediate check; `{"action":"test"}` sends exactly one test message.
- Desktop: Discord → GENERAL → FFXIV NEWS. Changes are stored in Cloud D1 across Desktop updates, not in local `settings.json`.

The feed titles are preserved as the official publishers wrote them; YURA's grouping, labels and guidance are in Polish. If a Fashion Report infographic cannot be fetched, the bot sends the publisher link rather than an unverified image.
