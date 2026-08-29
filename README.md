# Y.U.R.A. Network — Public Commands

Publiczna strona z listą komend kanału Heiyeshi.

## Pliki

- `index.html`
- `styles.css`
- `app.js`
- `commands.json`

## GitHub Pages

Po wrzuceniu plików do repo:

1. GitHub → Settings
2. Pages
3. Build and deployment → `Deploy from a branch`
4. Branch: `main`
5. Folder: `/ (root)`
6. Save

## Edycja komend

Edytuj `commands.json`.

Przykład:

```json
{
  "command": "!example",
  "aliases": ["!ex"],
  "permission": "Everyone",
  "usage": "!example <argument>",
  "description": "Opis komendy."
}
```


## v3
- `Widzowie` jest domyślną zakładką.
- `Wszystkie` jest trzecią zakładką.
- avatar jest w osobnym, większym panelu obok danych profilu.
- zielona kropka `ONLINE` ma powolną animację pulsowania.


## v4
- Avatar i dane profilu są zawsze obok siebie.
- Oba elementy używają identycznego stylu panelu.
- Między panelami jest 8 px przerwy.
- `Widzowie` jest domyślnym filtrem po wejściu na stronę.
- Dodano cache-busting do CSS/JS/JSON, żeby GitHub Pages nie pokazywał starej wersji po pushu.


## v5
- Duży, kwadratowy panel avatara po lewej.
- Osobny panel Heiyeshi po prawej.
- Link Twitch i Discord w panelu profilu.
- Y.U.R.A. CORE znajduje się pod panelem profilu, obok avatara.
- Nawigacja Commands / Leaderboard pozostaje poniżej całego bloku profilu.


## v6
- Avatar panel is a true square.
- Heiyeshi/Twitch/Discord panel is wider so links are fully visible.
- Y.U.R.A. CORE moved below the avatar.
- Commands/Leaderboard are the same width as the avatar panel.
- Footer is fixed near the bottom-left on desktop and stays in place while scrolling.

## v7
- Zaktualizowano publiczną bazę komend do bieżącej konfiguracji Streamer.bot.
- Dodano komendy standardowe, punktowe oraz kontrolę alertów.
- Dodano aktualne aliasy i składnię komend.
- Zachowano dotychczasowy layout v6 oraz domyślną zakładkę `Widzowie`.
- Zaktualizowano cache-busting do `v=7`.

## v8
- Pogrupowano komendy w czytelne sekcje tematyczne.
- Widzowie: Ogólne, Informacje, Punkty Y.U.R.A.
- Moderatorzy: Alerty, Overlay, Donacje, TTS, Punkty — Admin.
- Sekcje działają również z wyszukiwarką i filtrem Widzowie / Moderator / Wszystkie.
- Zaktualizowano cache-busting do `v=8`.

## v9
- Sekcje komend są zwijalne i domyślnie zamknięte.
- Kliknięcie nagłówka rozwija lub zwija wybraną kategorię.
- Wyszukiwanie automatycznie rozwija sekcje z pasującymi wynikami.
- `!afk` przeniesiono do komend moderatorskich / Overlay.
- `!tts` i `!tits` są dostępne dla wszystkich widzów.
- Zaktualizowano cache-busting do `v=9`.


## v11 — Leaderboard

- aktywowano zakładkę `Leaderboard`
- dodano TOP 3 w formie podium oraz miejsca 4–10 w tabeli
- ranking ładuje dane z `leaderboard.json`
- automatyczne odświeżanie co 15 sekund podczas otwartej zakładki
- ręczny przycisk odświeżania i znacznik ostatniej synchronizacji
- pusty stan do czasu podłączenia automatycznej publikacji danych z Y.U.R.A.

Format `leaderboard.json`:

```json
{
  "updatedAt": "2026-08-29T15:00:00+02:00",
  "entries": [
    { "name": "viewer", "points": 2500 }
  ]
}
```


## v11 — live leaderboard transport
Leaderboard data is now loaded from the `live-data` branch:
`https://raw.githubusercontent.com/its-hei/YURA-Network/live-data/leaderboard.json`

The public page polls the data every 15 seconds. Streamer.bot/Y.U.R.A. should update
`leaderboard.json` on the `live-data` branch whenever the points snapshot changes.


## v12 — leaderboard sync label
- changed the visible leaderboard cadence from `AUTO REFRESH 15 SEC` to `POINT SYNC 5 MIN`
- kept the internal page polling at 15 seconds so instant point changes from gamble/transfer/admin actions can still appear quickly
- the 5-minute label now reflects the normal passive points accrual cadence


## v13 — labels + leaderboard search
- side navigation renamed to `Komendy` and `Ranking`
- leaderboard title changed from `Leaderboard` to `Ranking`
- removed `Odśwież teraz` button and replaced it with viewer search on the ranking
- search highlights matching users and scrolls to the first match
- first commands group is expanded automatically on page load


## v14 — polish labels + stable search
- kept the same UI changes from v13
- fixed the commands view so the first group opens automatically only on initial load or filter change
- fixed leaderboard search so `LAST SYNC` stays correct while typing


## v15 — NETWORK HITS UI
- added `NETWORK HITS // 000000` to the top-right system status
- kept the ONLINE indicator and pulse intact
- added a six-digit padded counter hook (`#networkHits`)
- no fake/local counting is performed yet; the value stays at `000000` until the real global counter backend is connected


## v16 — live NETWORK HITS
- connected GoatCounter tracking for `yura-network.goatcounter.com`
- NETWORK HITS now reads the public site-wide TOTAL counter
- six-digit padded display is kept (`000001`, `001284`, etc.)
- counter refreshes locally every 5 minutes
- no API token or secret is stored in the public repository

### GoatCounter setup required
1. Verify the GoatCounter account email.
2. In GoatCounter Settings enable `Allow adding visitor counts on your website`.
3. Push this version to GitHub Pages and open the live site with ad blocking disabled for the first test.

Note: GoatCounter's public visitor-counter response may be cached for up to four hours even though pageviews normally appear in the GoatCounter dashboard much sooner.


## v17 — NETWORK HITS runtime fix
- remove duplicate `networkHits` JavaScript declaration that stopped the entire app
- restore command database loading
- restore leaderboard JavaScript
- keep GoatCounter TOTAL visitor counter integration
- bump frontend cache keys to v17


## v18 — isolate NETWORK HITS
- move GoatCounter counter code out of the main `app.js`
- add standalone `network-hits.js`
- commands and ranking no longer depend on GoatCounter in any way
- failure/adblock/CORS on GoatCounter can only affect the hit counter
- force-refresh `commands.json` with v18 cache key
- bump site assets to v18


## v19 — VIP/MOD eligibility filter
- add `POMIŃ VIP / MOD` toggle to the ranking toolbar
- when enabled, users already marked VIP or Moderator are removed before TOP 10 is calculated
- keep the normal ranking unchanged when the toggle is off
- leaderboard JSON now expects `isVip` and `isModerator` flags per entry
- export more than the visible TOP 10 so filtering can still produce a full eligible TOP 10


## v20 — Ranking Intelligence
- add global rank movement (`↑`, `↓`, `NEW`, `—`) based on the previous leaderboard snapshot
- add `NEXT VIP CANDIDATE` when `POMIŃ VIP / MOD` is enabled
- make commands and aliases click-to-copy with terminal feedback
- add a dedicated Changelog view backed by `changelog.json`
- keep VIP/MOD eligibility filtering, search, ranking sync, and NETWORK HITS
- bump frontend cache version to v20

### Streamer.bot requirement
Replace the C# in `Leaderboard Sync -> Execute Code` with
`tools/StreamerBot_Leaderboard_Sync_v20.cs.txt`.
The exporter adds `rankDelta` and `isNew` fields to the live leaderboard JSON.


## v20.1 — remove confusing root leaderboard placeholder
- removed the unused root-level `leaderboard.json`
- live ranking still loads from the `live-data` branch
- local generated leaderboard remains `tools/leaderboard.json`


## v21 — Monthly VIP Candidates
- replace `POMIŃ VIP / MOD` with a cleaner `KANDYDACI VIP` toggle
- while candidate mode is active, the same button changes to `WSZYSCY`
- change filtered ranking status from `VIP ELIGIBLE` to `KANDYDACI VIP`
- simplify ranking subtitle to `Ranking punktów Y.U.R.A.`
- add the monthly VIP reward rule directly to the ranking view
- bump frontend cache version to v21


## v22 — VIP Candidate Focus
- keep the ranking status chip as `LIVE DATA` regardless of active filter
- give `KANDYDACI VIP` a violet VIP accent and pulsing status dot
- make `WSZYSCY` a quiet return control while candidate mode is active
- remove the wide `NEXT VIP CANDIDATE` banner
- add a rotated `NEXT VIP` marker immediately left of the #1 candidate card
- subtly highlight the #1 candidate card in candidate mode
- bump frontend cache version to v22


## v23 — Czytelniejsze sterowanie rankingiem VIP
- powiększono pionowy znacznik `NEXT VIP`
- `KANDYDACI VIP` i `WSZYSCY` mają identyczną szerokość
- `WSZYSCY` ma własny pomarańczowy akcent i pulsującą kropkę
- od tej wersji wpisy w publicznym changelogu są po polsku
- podbito cache frontendu do v23


## v24 — Profil kanału i harmonogram
- dodano zakładkę `O mnie`
- dodano zakładkę `Harmonogram`
- harmonogram: PN–PT 16:00–19:00, SOB–ND 16:00–24:00
- dodano informację o przerwie PN–PT raz na trzy tygodnie związaną z pracą
- dodano informację o zmianach i dodatkowych dniach wolnych publikowanych na Discordzie
- publiczny changelog pozostaje po polsku
- podbito cache frontendu do v24
