# Mock-Wuensche aus dem Bereich layout

Stand 2026-08-20, nach der ersten Welle (67 von 70 Elementen bewiesen).
Reihenfolge nach Nutzen.

## 1. Fenstermodell fuer `plugin:window|*` (blockiert 3 Elemente)

**Blockiert:** `layout.minimize.click`, `layout.titlebar.toggle-maximize`,
`layout.close.click-2`.

Der Router faengt heute alles ab, was mit `plugin:` beginnt, und antwortet
mit `0`, ohne es zu protokollieren. Titlebar.tsx geht ueber
`@tauri-apps/api/window`, also `plugin:window|minimize`,
`plugin:window|toggle_maximize`, `plugin:window|close`, dazu
`plugin:window|is_maximized` und der Resize-Listener.

Gewuenscht:

* ein winziger Fensterzustand im Mock: `minimized`, `maximized`, `closed`
* `plugin:window|is_maximized` liefert diesen Zustand, `toggle_maximize`
  kippt ihn und feuert das Resize-Event, an dem Titlebar haengt
* alle drei in einem Bucket protokollieren, zum Beispiel
  `__E2E_WINDOW_CALLS__`

Damit wird aus dem heutigen Bruecken-Nachweis ein echter Wirkungsbeweis:
das Symbol muss dem Zustand folgen (Quadrat gegen Doppelquadrat), und
`closed` ist pruefbar.

Bis dahin pinnt `e2e/layout-titlebar.spec.ts` wenigstens die Verdrahtung
bis zur Bruecke, plus die Mac-Regel (dort zeichnet LU gar keine eigenen
Knoepfe, das ist voll geprueft).

## 2. Scriptbarer Updater (`plugin:updater|*`)

**Betrifft:** `layout.update-panel.download`,
`layout.update-panel.retry-download`, `layout.update-panel.install-restart`.
Alle drei sind bewiesen, aber nur auf ihrem Fehlerzweig, weil in diesem
Prozess nie ein echter `Update`-Handle entsteht.

Ohne Mock antwortet `plugin:updater|check` mit `0`, was der Plugin-Code als
"kein Update vorhanden" liest und ein geseedetes Update fuenf Sekunden nach
dem Start wieder aus dem Store raeumt. Die Specs setzen deshalb selbst eine
Ablehnung auf die Bruecke, was ehrlich ist (unerreichbarer Server), aber die
Sonnenseite offen laesst.

Gewuenscht: eine Option `updater?: { version, notes, downloadChunks?, failDownload? }`,
die

* `plugin:updater|check` mit echten Update-Metadaten beantwortet
* `plugin:updater|download` Fortschrittsereignisse ueber den Channel schickt
  (Started, Progress, Finished), damit Prozent und Bytes im Panel laufen
* `plugin:updater|install` als Erfolg quittiert, damit die Kette bis
  `exit_app` durchlaeuft (das Kommando gibt es schon)

Dann sind zusaetzlich pruefbar: Fortschritt in Prozent und Bytes, der
Uebergang Fehler zu Fortschritt beim Retry, und der echte
Installations- und Beenden-Pfad.

## 3. Download-Kommandos protokollieren und einen Zustand fuehren

**Betrifft:** `layout.pause.click` und `layout.cancel-all.click` auf der
ComfyUI-Seite, sowie jede kuenftige Buendelreise.

`pause_download`, `cancel_download` und `resume_download` geben heute stumm
`null` zurueck, und `download_progress` meldet nur die Dateien, die ueber
`download_model` gestartet wurden, immer sofort als `complete`. Deshalb
kann ein Spec keinen laufenden, keinen pausierten und keinen
fehlgeschlagenen ComfyUI-Download aus dem Mock heraus erzeugen. Die Specs
setzen die Ausgangslage jetzt ueber die Store-Aktionen, die die
Discover-Seite selbst benutzt, und schalten das Polling vorher ab, weil ein
Poll den geseedeten Stand sonst eine Sekunde spaeter ueberschreibt.

Gewuenscht:

* Buckets fuer `pause_download`, `cancel_download`, `resume_download`
  (heute nur ueber den spec-eigenen Bruecken-Mitschnitt sichtbar)
* eine Option, die den Fortschritt schrittweise laufen laesst, statt sofort
  `complete` zu melden, mindestens `downloading` mit Prozentwerten
* eine Option, die eine benannte Datei auf `error` setzt

## 4. Ollama-Pull mit steuerbarer Dauer

**Betrifft:** `layout.pause.click`, `layout.resume.click`.

`pull_model_stream` ist nach fuenfzig Millisekunden fertig, also gibt es
kein Zeitfenster, in dem ein Mensch Pause druecken koennte. Die Reise legt
den laufenden Pull deshalb ueber `useModelStore.startPull` an, genau wie es
die Models-Seite tut, und laesst erst das Fortsetzen den echten Pull ueber
die Bruecke schicken.

Gewuenscht: eine Option `pullStepDelayMs`, damit ein Pull lange genug
laeuft, um ihn im Panel anzuhalten und wieder anzuwerfen.

## 5. Kleinigkeit: Zwischenablage

Kein Mock noetig, aber als Notiz fuer andere Bereiche: die Kopier-Knoepfe
im Remote-Panel und im QR-Fenster sind ueber
`context.grantPermissions(['clipboard-read', 'clipboard-write'])` und
`navigator.clipboard.readText()` voll pruefbar. Das braucht keinen
Umweg ueber einen Store.
