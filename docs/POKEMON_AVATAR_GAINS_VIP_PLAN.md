# Pokémon system — Twitch chat only (Y.U.R.A. v3.3.99)

## User experience
- `!pokemon`: on the first use, randomly assigns one supported Pokémon to that Twitch account **for free**; later uses display the Pokémon already assigned.
- `!pokeroll`: rerolls a **different** random Pokémon for **5,000 Y.U.R.A. Points**. A viewer must first use `!pokemon`.
- Nothing is selected or purchased on the website; no OAuth or login is required.
- The identity comes from authenticated Twitch EventSub chat, `chatter_user_id`.
- Successful first assignment or paid reroll sets `pokemon_profiles.avatar_mode='pokemon'` so the public leaderboard can display the Pokémon.
- Pokémon artwork is visible **only for the ranking #1 card**. Other positions show nicknames without avatars.

## Security and accounting
- PokeAPI species lookup is validated before storing; if unavailable, no new assignment or charge is made.
- A new `pokemon_rerolls` ledger with a unique Twitch message ID records purchases at 5,000 points.
- Cloudflare D1 executes debit, receipt, transaction history and assignment together in a transaction.
- A duplicated Twitch chat event must never charge twice.
- The old 15,000-point receipts remain preserved in the existing `pokemon_purchases` table. Migration 0009 introduces the new cost separately without wiping existing balances or Pokémon.

## Monthly GAINS and VIP
- GAINS is current-month earned EXP from the monthly checkpoint, not LEVELS gained.
- The previous completed month's eligible winner becomes current monthly VIP after actual grant; current leader is not automatically current VIP.
- The first captured baseline was 2026-10-25. Any dated fallback rank must be clearly labeled as dated, not live.

## Deployment
- Cloud must be updated to **Y.U.R.A. Cloud v3.3.99**, including D1 migration 0009; a public website commit by itself cannot activate the new Twitch chat commands.
- Y.U.R.A. Desktop v3.3.99 includes the updated commands metadata. Windows/.NET SDK required to compile.
