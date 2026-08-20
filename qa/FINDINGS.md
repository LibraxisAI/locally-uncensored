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
- Dazu die Backend-Kommandos ohne Aufrufer aus CONTRACT.md. Am 19.08.
  einzeln geprueft: `file_read` und `file_write` leben ueber das
  Handy-Relay (remote.rs:580), bleiben. Acht sind echte Kandidaten:
  `fs_info`, `get_chat_workspace_override`, `get_gpu_selection`,
  `install_searxng`, `ollama_search`, `search_status`,
  `searxng_status`, `tunnel_status`. Die drei SearXNG-Kommandos sehen
  nach einem nie fertig gebauten Feature aus.

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

# Stand nach der Welle (Phase 3b, 20.08.2026)

## Die acht Bug-Verdachte, live gegengeprueft

1. **Bestaetigt und gefixt.** Stale-Chip-Dismiss, `Header.tsx`, Commit
   1f19b7b8. Rot vor dem Fix, gruen danach, Element gebucht.
2. **Bestaetigt und gefixt**, mit einer Spannung fuer David.
   `src/stores/modelHealthStore.ts:69` persistierte `dismissed`, der
   Neustart brachte das Banner nicht zurueck. Jetzt sitzungsonly, wie
   die Beschriftung verspricht. ACHTUNG: der Kommentar von 2.5.9 hat
   die Persistenz absichtlich eingebaut, weil das Banner "bei jedem
   Start" wiederkam. Entweder das Verhalten oder die Beschriftung ist
   falsch, beides zusammen geht nicht. Die Beschriftung sitzt in
   `src/components/layout/StaleModelsBanner.tsx`, oben steht der Pfad
   falsch unter `src/components/models/`.
3. **Bestaetigt und gefixt.** Der Info-Klick lief fuer JEDE Karte durch
   Ollamas `/api/show`, der Fehler verschwand in einem leeren catch.
   Beim Built-in-GGUF zeigte das Fenster Ollamas Antwort, ohne
   erreichbares Ollama passierte gar nichts. Jetzt beschreibt sich ein
   Nicht-Ollama-Modell aus dem Listeneintrag, ein gescheiterter Probe
   oeffnet den Dialog trotzdem und nennt den Grund.
   `src/components/models/ModelManager.tsx:80`.
4. **Bestaetigt und gefixt.** `resetTutorial()` loeschte
   `tutorialCompleted`, das seit 2.5.9 niemand mehr setzt und niemand
   liest. Der Knopf setzt jetzt den Neu-Chat-Hinweis zurueck, der als
   einziger Agent-Hinweis noch lebt, und heisst danach.
5. **Bestaetigt und gefixt.** Der Run-Knopf jedes Workflows in den
   Settings war Dekoration (`onRun={() => {}}`). Motor, Store und
   `useWorkflow()` waren fertig gebaut und nie angeschlossen. Jetzt
   verdrahtet, mit Laufleiste, weil jeder eingebaute Workflow mit einem
   `user_input`-Schritt beginnt und ein blosses `startWorkflow()` ein
   Haenger statt eines Fix gewesen waere.
6. **Bestaetigt und gefixt** in `Onboarding.tsx`.
7. **Bleibt offen.** Der Markdown-Export der Benchmark-Tabelle wird im
   Browser nachweislich angeboten und traegt die Tabelle
   (`models.download-the-table-as-markdown.click` gebucht). Ob die
   Tauri-WebView den Blob-Anker wirklich auf Platte schreibt und wohin,
   kann der Mock nicht beweisen. Gehoert nach Phase 5.
8. **Teilweise beantwortet.** Der Galerie-Weg liefert im Harness ein
   echtes Download-Ereignis mit Dateinamen (`create.download.click`).
   Der native Speicherndialog der Buehne bleibt ein Phase-5-Punkt.

## Neu gefunden, waehrend die Reisen liefen

- **Datenverlust im Memory-Rundlauf.** `src/stores/memoryStore.ts:624`
  exportiert `- **titel**, inhalt`, der Import in Zeile 653 erwartet
  einen Gedankenstrich als Trenner. Ueber den Markdown-Weg wird der
  Titel deshalb zur ganzen Zeile und auf 60 Zeichen gekuerzt, der
  Inhalt ist weg. Der JSON-Weg ist verlustfrei. Ein Zeichen in einem
  der beiden Ausdruecke. NOCH NICHT GEFIXT.
- **Tote Prompt-Historie, gefixt.** `addToPromptHistory`
  (`src/stores/createStore.ts:744`) wurde nirgends gerufen, die Liste
  blieb ewig leer, und `PromptHistory` rendert bei leerer Liste `null`.
  Knopf und Aufklappmenue waren fuer keinen Nutzer je erreichbar,
  obwohl der Store die Liste persistiert. Angeschlossen in
  `Composer.tsx:70`, dem einzigen Punkt den beide Backends passieren.
- **`src/hooks/useWorkflow.ts:124`**: `cancelWorkflow()` bricht den
  Motor ab und schliesst die Ausfuehrung nie, ein abgebrochener Lauf
  stand danach fuer immer auf `waiting_input`. In `SettingsPage.tsx`
  geschlossen, die richtige Heimat ist der Hook.
- **`src/hooks/useWorkflow.ts:54`**: `stepIndex` unbenutzt, vorbestehend.

## Neue Kandidaten fuer anschliessen oder loeschen

- `settings.release-page.open` steht hinter `!isTauri()` und ist im
  Desktop-Build unerreichbar.
