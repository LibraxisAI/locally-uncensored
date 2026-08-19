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
