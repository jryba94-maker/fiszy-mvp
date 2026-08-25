# Fiszy — procedura bezpiecznego startu

## Próba generalna

Pełny przebieg wykonujemy najpierw na chronionym Vercel Preview, na oddzielnym prefiksie danych i w trybie testowym operatora płatności. Nie promujemy danych z Preview do Production. Po próbie aukcję archiwizujemy, zapisujemy raport CSV i weryfikujemy kolejkę e-mail.

## Backup przed startem

1. Potwierdź `VERCEL_ENV=production` oraz odcisk URL Redis.
2. Uruchom `npm run backup:export` w lokalnym, kontrolowanym katalogu.
3. Zaszyfruj eksport narzędziem systemowym i zapisz dwie kopie w miejscach z ograniczonym dostępem.
4. Nie commituj eksportu, nie przesyłaj go przez komunikator i nie pozostawiaj jawnej kopii.
5. Wykonaj próbne odtworzenie wyłącznie do pustego środowiska testowego.

## Procedura awaryjna

1. Nie wdrażaj kolejnej wersji w ciemno. Zapisz czas i objaw.
2. Jeśli trwa aukcja, nie usuwaj winnera ani zamówienia ręcznie. Najpierw sprawdź panel operacyjny i logi.
3. Przy problemie z e-mail uruchom kontrolę kolejki; wiadomość `dead` ponów tylko dedykowanym przyciskiem.
4. Przy problemie z płatnością porównaj stan operatora, webhooka, winnera i zamówienia. Nie oznaczaj płatności jako opłaconej ręcznie.
5. Przy błędzie nowego wdrożenia przywróć ostatnie sprawdzone wdrożenie Vercel. Rollback kodu nie cofa płatności ani danych.
6. Po incydencie pobierz raport, zachowaj logi i opisz decyzje w audycie.

## Kryterium startu

Start jest dozwolony dopiero, gdy panel „Gotowość pierwszej aukcji” nie ma blokad, wykonano backup, telefon bez konta administratora otwiera właściwą aukcję, a operator zna powyższą procedurę.
