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
