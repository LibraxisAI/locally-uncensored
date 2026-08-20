# Mock-Wuensche: Bereich settings

Stand 20.08.2026, Welle 1 (Reisen). 72 von 86 Elementen bewiesen,
14 blockiert. Jeder Punkt unten schaltet eine feste Zahl davon frei.
Reihenfolge nach Ertrag.

## 1. `comfyui_status` muss antworten koennen (5 Elemente)

Heute rejected `comfyui_status` immer (`tauri-mock.ts:680`). Die
Frontend-Seite (`ComfyUISettings.check()`) faengt den Reject und laesst
`status` fuer immer auf `null`. Damit werden weder `status.found` noch
`status.running` je wahr, und genau daran haengt die halbe Steuerleiste.

Blockiert: `settings.comfyui-engine.start`,
`settings.comfyui-engine.stop`, `settings.comfyui-engine.restart`,
`settings.comfyui-env.repair`, `settings.comfyui-update.start`.

Wunsch: `comfyui_status` beantwortet die Option `comfy.installed` bzw.
einen neuen Schalter `comfy.running` mit der Form aus
`src-tauri/src/commands/process.rs`, also mindestens
`{ running, found, complete, path, port, host, isLocal, starting, stalled }`.
`start_comfyui` / `stop_comfyui` sollten den `running`-Zustand kippen,
damit Start, Stop und Restart eine echte Wirkung haben.
Der Reject bleibt sinnvoll als eigene Option (frische Box), er darf nur
nicht der einzige Fall sein. Achtung: `mac-create-mlx.spec.ts` verlaesst
sich darauf, dass der Aufruf im Bucket `__E2E_COMFY_CALLS__` landet, das
muss bleiben.

## 2. `plugin:updater|check` muss ein Update anbieten koennen (4 Elemente)

`tauri-mock.ts:1788` beantwortet jedes `plugin:`-Kommando mit `0`.
`@tauri-apps/plugin-updater`'s `check()` macht daraus `null`, der
Update-Store meldet "kein Update", und der ganze gruene Update-Block in
`UpdateSection` wird nie gerendert.

Blockiert: `settings.update.download`,
`settings.update.install-restart`, `settings.update-download.retry`,
`settings.update-badge.restore`.

Wunsch: eine Option `updater?: { version, notes, downloadFails? }`.
`plugin:updater|check` liefert dann die Metadaten-Form, die der Plugin-
Wrapper erwartet (mindestens `{ available: true, version, currentVersion,
body, rid }`), `plugin:updater|download_and_install` bzw.
`plugin:updater|download` melden Fortschritt ueber den Event-Kanal, den
der Mock schon fuehrt. `downloadFails: true` fuehrt in den Fehlerzustand,
womit auch Retry fahrbar wird. Fuer `update-badge.restore` reicht es,
dass der Block ueberhaupt steht; die Verwerfung setzt der Spec selbst.

## 3. `whisper_status` und `install_tts_status` (2 Elemente)

Bekannte Grenze, hier nur der Vollstaendigkeit halber und mit dem
konkreten Schaden:

- `whisper_status` rejected (`tauri-mock.ts:686`). Der Install laeuft
  durch, `refreshWhisper()` danach liest wieder den Reject, das Badge
  bleibt rot. Die Reise endet also in einem Zustand, den ein echter
  Nutzer als Fehlschlag lesen wuerde.
- `install_tts_status` rejected (`tauri-mock.ts:687`). `handleInstallTts`
  faengt jeden Reject als "transient" und pollt weiter. Die Schleife
  bricht erst nach dem 600-Sekunden-Deckel ab, der Spinner laeuft bis
  dahin. Nicht fahrbar.

Blockiert: `settings.whisper.install`, `settings.piper-tts.install`.

Wunsch: beide Kommandos wie die uebrigen Install-Slots bedienen, also
`{ status: 'installing' | 'complete' | 'error', logs, error }` mit einem
Slot der nach ein paar Polls fertig wird, und `whisper_status` liefert
danach `{ available: true, backend: 'faster-whisper', error: null }`.

## 4. `lmstudio_server_status` (1 Element)

Rejected (`tauri-mock.ts:685`), also bleibt `lmStudioInfo` in
`ProviderConfig` auf `null` und der Knopf wird nie gerendert. Er
erscheint nur bei `lms_present === true && running === false`.

Blockiert: `settings.lmstudio-server.start`.

Wunsch: Option `sys.lmStudio?: { present: boolean; running: boolean }`,
`lmstudio_server_status` antwortet damit statt zu rejecten, und
`start_lmstudio_server` kippt `running` auf true, sobald `present`.
Heute rejected `start_lmstudio_server` mit dem Not-installed-Text
(`tauri-mock.ts:1617`), was zur Vorgabe passt und so bleiben kann.

## 5. MCP-Prozess ueber `plugin:shell|spawn` (1 Element)

`MCPExternalClient.connect()` braucht `Command.create(...).spawn()` mit
lebendem `stdout`-Event und `stdin.write`. Der Mock beantwortet jedes
`plugin:`-Kommando mit `0`, also gibt es kein Child-Objekt.

Blockiert: `settings.mcp-server.connect-toggle`.

Wunsch: ein minimaler stdio-JSON-RPC-Gegenpart. Er muesste auf
`initialize` und `tools/list` antworten, mehr braucht die Verbindung
nicht: danach registriert die UI die Werkzeuge und die Zeile wird gruen
mit "N tools". Das ist der aufwendigste Punkt der Liste und der mit dem
kleinsten Ertrag, deshalb steht er hinten.

## Kein Mock-Wunsch: `settings.release-page.open`

Der Knopf steht hinter `!isTauri()`. Der Mock setzt
`__TAURI_INTERNALS__`, also ist `isTauri()` immer true. Das ist keine
Mock-Luecke, sondern die Wahrheit: im Desktop-Build ist dieser Knopf
unerreichbar, er existiert nur als Dev-Modus-Fallback. Entscheidung fuer
David: anschliessen oder loeschen, so wie die uebrigen toten Pfade in
FINDINGS.md.
