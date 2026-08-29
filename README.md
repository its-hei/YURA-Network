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
