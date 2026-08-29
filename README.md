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
