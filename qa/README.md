# QA-Buchfuehrung fuer die Release-Reife

Dieses Verzeichnis ist der Zustand, nicht das Verfahren. Das Verfahren
(Skripte, Schemas, die vier Auftragstexte) liegt auf dem Mac unter
`~/.claude/skills/qa-sweep/` und ist projektneutral.

## Dateien

- `INVENTORY.yaml`: ein Eintrag pro interaktivem Element (onClick/onSubmit
  in src/, ohne Tests) und pro tauri::command. Generiert von scan.mjs,
  manuell ergaenzt. Die Felder precondition, expected, status, covered_by
  und notes ueberleben jeden Neuscan; verschwundene Eintraege werden
  stale markiert, nie geloescht.
- `JOURNAL.jsonl`: append-only, eine Zeile pro Statuswechsel. Ein pass
  zaehlt nur mit Commit-Hash und Artefakt unter artifacts/.
- `CONTRACT.md`: Kommandos gegen Frontend-invokes und den Mock-Router
  (Phase 1, offen).
- `artifacts/`: Traces und Screenshots, gitignored.

## Bedienung

    node ~/.claude/skills/qa-sweep/scripts/scan.mjs .      # Inventar neu erheben
    node ~/.claude/skills/qa-sweep/scripts/coverage.mjs .  # ehrlicher Stand als Zahlen
    node ~/.claude/skills/qa-sweep/scripts/verify.mjs .    # Anti-Cheat, Exit 1 bei Verstoss

Testharness ist der vorhandene: `playwright.config.ts` faehrt die echte
React-App im Chromium mit `e2e/support/tauri-mock.ts` als Bridge-Stub.
Die Rust-Seite deckt `cargo test` plus der Contract ab.

## Ausgangszahl vom 19.08.2026 (Branch qa/sweep auf 2.6.5, bf903044)

- 556 interaktive Elemente, davon 7 mit data-testid direkt am Element,
  0 von einem Spec ueber testid beruehrt, Journal leer.
- 171 tauri-Kommandos, 25 davon direkt per invoke aus dem Frontend gerufen.
  Die Luecke ist Phase-1-Arbeit: entweder ein Wrapper oder toter Rust-Code.
- 13 Playwright-Specs vorhanden, sie selektieren ueber Text und Rollen,
  nicht ueber testids.

KERNZAHL: von 556 Elementen sind 0 nachweislich getestet. Diese Zahl ist
das einzige Fortschrittsmass; sie steigt nur ueber Journaleintraege mit
Artefakt.

## Regeln

- Rot heisst App reparieren, nie den Test.
- Kein pass ohne Artefakt, kein Push und kein Release ohne Davids Go.
- Bedingte Env-Gates (test.skip(bedingung, grund)) sind erlaubt,
  bedingungslose Skips nicht; verify.mjs prueft das.

## Stand nach Phase 2 (19.08.2026 nachmittags)

536 von 556 Elementen adressierbar (data-testid = Inventar-id), 26 geparkt
mit Grund, 0 offen ohne Adresse. Fuenf Wrapper (create/ui/Button,
DeleteButton, ToolBtn, IconBtn, PromptField, dazu WorkspaceOption im Chat)
reichen data-testid als optionale Prop durch, Instanz-Wert schlaegt
Fallback. Gates: tsc Baseline unveraendert (333 vorbestehende Fehler, kein
neuer), vitest 4778 gruen, Playwright 11 gruen und 3 Env-geskippt.

## Phase 3, Schritt 1: Mock-Ausbau (19.08.2026)

Alle 99 lebenden Kommandos ohne case haben jetzt einen, erhoben aus der
Rust-Quelle und jedem Frontend-Aufrufer (sechs Agenten, disjunkte
Domaenen, Zusammenbau von Hand). Herkunftsnachweis pro Form mit
Rust-Zeile: `qa/MOCK-NOTES.md`. Die Default-Welt bleibt die frische
Box; abweichende Ausgangslagen fahren ueber die neuen Optionen in
`TauriMockOptions` (`comfy`, `sys`, `trainer`, `voice`, Remote/OAuth,
Import/LMS). Beweis der Abdeckung: Abgleich der CONTRACT-Fehlt-Liste
gegen die case-Namen ergab leer, kein alter case verloren. Der volle
Playwright-Bestand lief danach gruen (Regressionsgate).

Offene Restspannung: die historischen Rejects `whisper_status` und
`install_tts_status` blockieren die vollen Settings-Install-Reisen,
Details in CONTRACT.md und MOCK-NOTES.md.

## Korrektur zur Gate-Historie, gefunden am 19.08.2026

Die "Playwright gruen"-Gates aus Phase 0 bis 2 waren KEINE Vollaeufe:
die Laeufe wurden extern abgebrochen, Playwright listete die restlichen
Tests markerlos als "did not run" und meldete trotzdem Exit 0. Echte
Bilanz damals: 10 bis 11 von 37. Der erste ehrliche Volllauf deckte
zwei Harness-Luecken auf, beide nur auf einem Entwickler-Mac sichtbar:

1. localFetch faellt bei einem Proxy-Reject auf einen direkten
   Browser-Fetch zurueck, und der traf hier ein ECHTES Ollama auf
   11434, AirPlay auf Port 5000 und einen fremden Dev-Server auf 4000.
   Der Mock versiegelt jetzt jeden localhost-Fetch ausser dem
   Vite-Server selbst; die frische Box gilt auf jeder Maschine.
2. seedOnboardingDone baute einen unmoeglichen Nutzer: onboardingDone
   ohne Release-Notes-Stempel liest die App als Upgrader, seit 2.6.5
   bootet der unter dem "What is new"-Blatt, das jede Bedienung
   verdeckt. Der Seed stempelt jetzt wie das echte Onboarding-Finish.

Danach der erste ehrliche Volllauf: 34 von 34 bestanden, 3 Env-Skips,
0 rot, 2 Minuten statt 24. Merksatz fuers Verfahren: ein Playwright-
Exit 0 beweist keinen Volllauf, die Bilanzzeile muss passed+skipped =
Gesamtzahl aus `npx playwright test --list` ergeben. Diese Pruefung
steht jetzt als Pflichtschritt im Schleifen-Prompt des Verfahrens.
