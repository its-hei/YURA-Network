# Y.U.R.A. — ranking avatars, Pokémon and monthly GAINS VIP

**Status:** specification only. Do not implement in Y.U.R.A. Desktop or Cloud until user explicitly authorizes the next version. Public website currently supports read-only `avatarMode` and `pokemonId` when a trusted backend supplies those fields.

## 1. Identity and avatar choice (website)

- Each viewer may choose how **their own** identity appears in rankings: **Twitch avatar** (default) or a **Pokémon**.
- This is a persistent **account-level** preference, not a cosmetic browser-wide switch.
- Require authenticated Twitch identity (OAuth + verified session). Do not accept a freely typed login as authorization to change somebody else's public avatar.
- Store in Cloud database keyed by Twitch user ID: `avatar_mode` (`twitch` or `pokemon`), `pokemon_id` (numeric Pokédex ID), and update timestamp.
- When a viewer chooses Pokémon for the first time, assign **one randomly chosen supported Pokémon** and save the assignment. Do not rerandomize on every page load.
- The website should support selecting Twitch/Pokémon display for that viewer without any points charge. Changing which Pokémon is assigned costs points (below).
- Public ranking API returns only safe display fields, e.g. `avatarMode: "pokemon"`, `pokemonId: 25`. Never expose OAuth tokens.
- Frontend fallback: when the preference or sprite is missing/invalid, use the ordinary Twitch avatar.
- Render the chosen visual consistently in GAINS / LEVELS / POINTS, including #1, #2/#3, and #4–#10.

## 2. `!pokemon <name>` on Twitch — costs 15,000 Y.U.R.A. Points

- Example `!pokemon pikachu` selects Pikachu as the viewer's Pokémon and activates Pokémon mode.
- Validate Pokémon name against the Pokédex (case-insensitive, account for approved aliases/forms).
- Charge **15,000 Y.U.R.A. Points**, not native Twitch points and not EXP.
- Check sufficient balance and atomically charge+update the assignment in a database transaction. On insufficient funds, invalid name, unknown viewer, duplicate event, or other error: **never charge**.
- Prevent double charges from repeated delivery of the same Twitch message (idempotency key).
- Confirm the Pokémon name and price only after the database commit. Cache Pokédex name/ID lookups to avoid unnecessary third-party API load.
- Switching between already-assigned Pokémon and Twitch avatar on the authenticated website is free; choosing **another** Pokémon via command costs 15,000 points.

## 3. Monthly GAINS and current VIP

- GAINS = verified EXP earned **since the beginning of the active monthly checkpoint**, e.g. `monthlyExp = currentExp - baseExp` (not gained LEVELS).
- First tracked period: **25–31 October 2026**, with checkpoint 25 October 2026 at 11:54:18 UTC.
- New month starts at 00:00 Europe/Warsaw. Start a new EXP baseline without resetting lifetime EXP or LEVEL.
- Freeze the completed month before switching to the next period, preserve historical GAINS.
- **Current GAINS VIP** is the eligible winner of the **previous completed month**, after confirmation / successful assignment of the Twitch VIP role. Do not show the current leader as already holding that role.
- If previous-month results or award confirmation are unavailable, show a transparent unavailable status, not a fabricated username.
- Permanent VIPs and moderators are not eligible for the monthly GAINS contest.
- Cloud should provide structured verified `currentMonthlyVip` details (name/login, wonMonth, activeMonth, status), rather than guessing from the current month's leaderboard.

## 4. Current frontend publication

- Static D1-verified snapshot: `gains-exp-2026-10.json`, measured 26 Oct 2026. 1,130 / 690 / 370 EXP for the top three.
- It must be explicitly labeled **dated**, not live; never refresh its timestamp to pretend the values update.
- Only display it for October 2026 when `/api/ranking` lacks `monthlyExp`; prefer verified live monthly EXP automatically after the Cloud update.
- The website can render a future Pokémon preference from the ranking API but does not currently support saving selections or taking Y.U.R.A. points.

**Next Y.U.R.A. version is deferred until the user requests it.**
