# Y.U.R.A. — katalog Pokémonów (Generacje I–IX)

**1025 gatunków • 9 generacji • Pokédex narodowy #0001–#1025.**

To robocza baza do rozwijania `!pokemon` i `!pokeroll`. Każda generacja ma własny plik CSV (UTF-8, separator `;`) do otwarcia w Excelu. Edytuj **te pliki generacyjne**, a pliki zbiorcze generuj skryptem.

| Generacja | Region / era | Numeracja | Pokémonów | Plik |
|---|---|---:|---:|---|
| I | Kanto | #0001–#0151 | 151 | [gen-1-kanto.csv](gen-1-kanto.csv) |
| II | Johto | #0152–#0251 | 100 | [gen-2-johto.csv](gen-2-johto.csv) |
| III | Hoenn | #0252–#0386 | 135 | [gen-3-hoenn.csv](gen-3-hoenn.csv) |
| IV | Sinnoh | #0387–#0493 | 107 | [gen-4-sinnoh.csv](gen-4-sinnoh.csv) |
| V | Unova | #0494–#0649 | 156 | [gen-5-unova.csv](gen-5-unova.csv) |
| VI | Kalos | #0650–#0721 | 72 | [gen-6-kalos.csv](gen-6-kalos.csv) |
| VII | Alola | #0722–#0809 | 88 | [gen-7-alola.csv](gen-7-alola.csv) |
| VIII | Galar / Hisui | #0810–#0905 | 96 | [gen-8-galar-hisui.csv](gen-8-galar-hisui.csv) |
| IX | Paldea | #0906–#1025 | 120 | [gen-9-paldea.csv](gen-9-paldea.csv) |
| **Łącznie** | | | **1025** | [cały katalog CSV](catalog.csv) |

## Edycja

Każdy Pokémon ma: **Numer, Nazwę, Identyfikator, Generację, Region, Kategorię, Losowanie, Wagę, Notatki**.

- `Losowanie`: `TAK` lub `NIE`. Zmiana na NIE oznacza wyłączenie z przyszłej puli losowań.
- `Waga`: 1–100; 1 = domyślna. Później możemy ustalić, czy legendarne/mityczne mają mniejszą szansę.
- `Notatki`: pole do planowanych ograniczeń i pomysłów. Wpisy nie mają jeszcze wpływu na działanie komend.
- `Kategoria`: zwykły, legendarny, mityczny według klasyfikacji źródłowej.
- Nie zmieniaj numerów Pokédex ani identyfikatorów, bo Y.U.R.A. będzie używać ich jako kluczy.

Po zapisaniu edycji w CSV w folderze katalogu uruchom:

```bash
node rebuild.mjs
```

Skrypt weryfikuje wszystkie 1025 pozycji, zakresy generacji, brak duplikatów i dozwolone wartości. Następnie odtwarza **[catalog.csv](catalog.csv)** i **[catalog.json](catalog.json)**.

**Ważne:** to katalog roboczy. Wgranie / edycja CSV w repozytorium **nie zmienia automatycznie losowań na Twitchu**. Aby ustawienia zaczęły sterować `!pokemon` / `!pokeroll`, trzeba podłączyć import katalogu po stronie Y.U.R.A. Cloud (z zachowaniem zapisanych Pokémonów widzów i sald punktów).

## Dane źródłowe

- [PokéAPI: pokemon_species.csv](https://github.com/PokeAPI/pokeapi/blob/master/data/v2/csv/pokemon_species.csv) — # Pokédex, generacja, legendarny / mityczny.
- [PokéAPI: pokemon_species_names.csv](https://github.com/PokeAPI/pokeapi/blob/master/data/v2/csv/pokemon_species_names.csv) — nazwy angielskie (`local_language_id=9`).
- [National Pokédex (Pokémon)](https://www.pokemon.com/pokedex/) — weryfikacja zakresu #0001–#1025.

Zakres: podstawowe **gatunki**, bez alternatywnych form (Mega, regionalne itp.), które mogą zostać rozbudowane osobno.
