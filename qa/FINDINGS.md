# Befunde aus Phase 1 (Inventar fuellen, 19.08.2026)

Beim Lesen des Codes gefunden, noch NICHT am laufenden Build verifiziert.
Jeder Punkt ist entweder ein Testkandidat fuer die Schleife oder eine
Aufraeumentscheidung fuer David.

## Bug-Verdachte, live gegenpruefen

1. Der Dismiss am Stale-Modell-Chip wirkt vermutlich nicht:
   `src/components/layout/Header.tsx:242` setzt nur lokalen State, der
   Effekt ab Zeile 114 baut den Chip aus dem modelHealthStore sofort
   wieder auf.
2. "Dismiss until next launch" am Stale-Banner
   (`src/components/models/StaleModelsBanner.tsx:100`) persistiert laut
   Store in Wahrheit ueber den Neustart hinaus. Label und Verhalten
   widersprechen sich; der Test muss ueber einen Neustart pruefen.
3. Der Info-Klick an der Modellkarte (`src/components/models/ModelCard.tsx:64`)
   verschluckt Fehler von showModel; bei Nicht-Ollama-Modellen bleibt der
   Klick komplett reaktionslos.
4. "Reset tutorial" (`src/components/settings/SettingsPage.tsx:1532`) setzt
   ein Flag zurueck, das keine Komponente liest. Knopf ohne Wirkung.
5. `src/components/settings/SettingsPage.tsx:247` uebergibt ein leeres
   onRun an die WorkflowList: der Run-Knopf jedes Workflows in den
   Settings tut nichts.
6. `src/components/onboarding/Onboarding.tsx:1391` blendet die Pfad-Zeile
   unter einer immer wahren Bedingung ein; der Handler bei 1377 baut ein
   input-Element, das nie benutzt wird.
7. Benchmark-Export (`src/components/models/BenchmarkView.tsx:93`) haengt
   an einem a-download auf einer Blob-URL; ob die Tauri-WebView das
   speichert und wohin, ist offen.
8. Download-Wege sind uneinheitlich: die Galerie
   (`src/components/create/CreatePanel.tsx:118`) laedt ueber den
   WebView-Anker mit openExternal-Fallback, die Buehne
   (`src/components/create/experimental/OutputView.tsx:228`) nimmt den
   nativen Speicherndialog.

## Unerreichbare UI, Entscheidung noetig: anschliessen oder loeschen

- `src/components/chat/HtmlPreviewModal.tsx`: 8 Elemente, nirgends
  importiert. Der oeffnende Chip existiert nur noch als Kommentar in
  `src/components/chat/CodeBlock.tsx:16`.
- `src/components/create/ui/EmptyState.tsx:59` und 60: kein Aufrufer
  uebergibt action oder secondaryAction, beide Knoepfe unerreichbar.
- Ohne jeden Aufrufer: `WorkflowRunner.tsx`, `TaskBreakdown.tsx`,
  `ui/ToggleSwitch.tsx`, `AgentLog.tsx` (letzteres waere die einzige
  Bruecke zu den Freigabeknoepfen der agents/ToolCallCard; die echte
  Freigabe laeuft ueber chat/ToolCallBlock plus ApprovalDialog).
- Dazu die 10 Backend-Kommandos ohne Aufrufer aus CONTRACT.md.

## Grenzen des Scanners, beim Lesen gefunden

- onMouseDown-Handler werden nicht erfasst
  (`src/components/chat/ChatInput.tsx:311` und 318).
- a-download-Anker ohne onClick werden nicht erfasst
  (`src/components/chat/ToolCallBlock.tsx:401`).
- Das Hint-Fenster kann das aria-label eines Nachbarelements erwischen;
  zwei Faelle im Layout, in den notes der Eintraege korrigiert.
- onClick-Props, die an Komponenten weitergereicht werden, zaehlen als
  eigenes Element (Doppelzaehlung am ModelSelector), reine
  stopPropagation-Wrapper ebenso. Steht in den notes.
