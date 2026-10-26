# Jednorazowe uruchomienie automatycznego Y.U.R.A. Cloud

Po konfiguracji zmiany w `cloud/yura-cloud/**` na gałęzi `main` automatycznie uruchamiają GitHub Actions, nakładają **wyłącznie niezastosowane** migracje D1 i wdrażają istniejącego Workera `yura-cloud`.

## Jednorazowa konfiguracja (właściciel repozytorium)

1. W tym folderze (`cloud/bootstrap/`) wybierz **Add file → Upload files** i prześlij bez zmiany nazwy `YURA_Cloud_v3.3.102.zip`, pobrany wcześniej z rozmowy. To tylko jednorazowy import źródeł; archiwum nie może zawierać tokenów ani plików prywatnych.
2. W Cloudflare otwórz **Account → API Tokens → Create Token** i utwórz token do wdrażania Workers i zarządzania D1, ograniczony do swojego konta (uprawnienia Workers Scripts: Edit oraz D1: Edit).
3. W GitHub repozytorium wejdź do **Settings → Secrets and variables → Actions** i dodaj dwa **Repository secrets**:
   - `CLOUDFLARE_API_TOKEN` – token z kroku 2.
   - `CLOUDFLARE_ACCOUNT_ID` – identyfikator konta Cloudflare, **nie** identyfikator bazy D1.
4. Otwórz **Actions → Deploy Y.U.R.A. Cloud → Run workflow** na gałęzi `main`. Sprawdź zielony wynik zadania.

**Nie dodawaj `ADMIN_KEY`, tokenów Twitch ani `EVENTSUB_SECRET` do GitHuba.** Już istniejące sekrety Workera pozostają po stronie Cloudflare.

## Co robi pierwsze uruchomienie

- Importuje z ZIP wyłącznie `src/index.ts`, pliki `migrations/*.sql` oraz publiczną konfigurację `wrangler.toml` i konfigurację kompilacji.
- Zapisuje źródła w `cloud/yura-cloud/`, tak aby następne zmiany można było robić bez ZIP-ów.
- Sprawdza nazwę Workera i identyfikator **istniejącej** D1: `a9a1cd82-2b0e-46a1-910a-706a6bd6f4d9`. Nie tworzy nowej bazy ani nie czyści istniejącej.
- Ustawia `keep_vars = true` i nie przepisuje wartości zmiennych z `[vars]` lokalnej paczki; konfiguracja produkcyjna Workera w dashboardzie ma pierwszeństwo.
- Instalacja Node, kontrola budowania, migracje `--remote`, wdrożenie `--keep-vars` i test `/health`.

## Kolejne aktualizacje

Po jednorazowym imporcie każda zmiana plików źródłowych w `cloud/yura-cloud/**` na `main` uruchamia automatyczną aktualizację. Zmiany statycznej strony WWW nie powodują wdrożenia Workera. Można też uruchomić workflow ręcznie.

Migracje modyfikują żywą bazę danych, dlatego wymagają przeglądu przed zatwierdzeniem. Sekrety i salda nie są resetowane przez sam proces wdrażania.

Jeśli GitHub nie pozwoli workflow na jednorazowe zatwierdzenie importu, upewnij się, że **Settings → Actions → General → Workflow permissions** dopuszcza `Read and write permissions` dla `GITHUB_TOKEN`. Nie przekazuj sekretów przez zgłoszenia, zrzuty ekranu ani publiczne pliki.
