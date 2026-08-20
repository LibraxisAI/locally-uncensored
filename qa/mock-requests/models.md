# Mock-Wuensche Bereich models (Welle 20.08.2026)

Elf Elemente sind blockiert, weil `e2e/support/tauri-mock.ts` die noetige
Ausgangslage nicht herstellen kann. Die Wuensche stehen nach Hebelwirkung
sortiert: Wunsch 2 und 3 zusammen entsperren die meisten Elemente und
haerten nebenbei jeden Ollama-Beweis im ganzen Sweep.

---

## 1. Ein Chat-Stream, der scheitern kann

**Blockiert:** `models.benchmark-error.dismiss`, und die zweite Haelfte von
`models.benchmark-remaining.run` (Kettenabbruch beim ersten Fehler).

`proxy_localhost_stream_chunked` antwortet URL-unabhaengig immer mit der
Standard-SSE. Damit kann kein `provider.chatStream` werfen, also kann der
Benchmark-Store nie einen Fehler setzen und der rote Hinweis existiert nie.

**Wunsch:** eine Option wie `failStreamFor?: string[]` (Teilstring der URL,
etwa `'11434'`), bei der der Case rejected statt zu liefern. Damit laesst
sich ein toter Backend-Port bauen, ohne die Vorgabewelt anzufassen.

## 2. `/api/ps` und `/api/generate` mit eigenem Zustand

**Blockiert:** `models.model-row-vram.toggle`. Schwaecht ausserdem den
Beweis von `models.unload-all.click` und `models.delete-dialog.confirm`.

`case 'proxy_localhost'` beantwortet JEDE URL mit `11434` darin mit der
`/api/tags`-Nutzlast. Folgen: `/api/ps` meldet immer alle Modelle als
geladen, ein Laden oder Entladen aendert daran nichts, und `/api/delete`
quittiert erfolgreich, ohne dass das Modell aus der Liste faellt.

**Wunsch:** die Ollama-Antwort nach Pfad aufteilen und einen kleinen
Zustand halten, wie es die anderen Flaechen im Mock schon tun:

- `/api/tags` liefert die Liste `ollamaModels` **minus** was `/api/delete`
  entfernt hat.
- `/api/ps` liefert ein eigenes Set `ollamaLoaded` (Startwert per Option,
  Vorgabe leer).
- `/api/generate` mit `keep_alive: 0` nimmt den Namen aus dem Set,
  jedes andere `keep_alive` legt ihn hinein.
- `/api/delete` entfernt aus `ollamaModels`.

## 3. Methode und Rumpf bei `proxy_localhost` mitschreiben

**Blockiert:** nichts allein, aber jeder Beweis, der heute nur den Pfad in
`__E2E_PROXY_URLS__` zaehlen kann, wird damit exakt.

**Wunsch:** zusaetzlich zum String-Bucket ein Bucket
`__E2E_PROXY_CALLS__` mit `{ url, method, body }`. Dann laesst sich
belegen, dass das Loeschen genau diesen Modellnamen trug und dass ein
Entladen wirklich `keep_alive: 0` schickte.

## 4. `lmstudio_server_status` aufloesen lassen

**Blockiert:** `models.lmstudio-server.start`,
`models.dismiss-returns-on-next-launch.click`.

Der LM-Studio-Hinweis in der Modellauswahl rendert nur, wenn
`lmstudio_server_status` mit `{ running: false, lms_present: true,
models_detected: true, model_count: n, port: 1234 }` AUFLOEST. Im Mock ist
der Case ein harter Reject, der Hinweis kann also nie erscheinen, und damit
sind beide Knoepfe darin unerreichbar. `start_lmstudio_server` ist bereits
da und rejected wie eine Box ohne LM Studio, das passt zum Fehlerpfad.

**Wunsch:** Option `lmstudio?: { present?: boolean; running?: boolean;
modelCount?: number }`, die diesen Case fuellt. Vorgabe bleibt der
heutige Reject.

## 5. Eine CivitAI-Antwort

**Blockiert:** `models.download.click`, `models.view-on-civitai.click`.

`searchCivitaiModels` holt die Trefferliste ueber `fetch_external`. Der
Mock liefert fuer alles ausser dem einen `hfTree`-Repo den String `null`,
also kommt jede Suche leer zurueck und es gibt keine Trefferzeile, an der
Download und Aussenlink haengen.

**Wunsch:** Option `civitaiItems?: unknown[]`, die `fetch_external` fuer
URLs mit `/api/v1/models` als `{ items: [...] }` zurueckgibt. Eine Zeile
mit `modelVersions[0].files[0]` und `downloadUrl` reicht.

## 6. Die URL von `fetch_external` mitschreiben

**Blockiert:** `models.civitai-mirror.select`.

Der Spiegelumschalter wirkt ausschliesslich auf die URL der naechsten
Suche. Die geht an `fetch_external`, und dieser Case schreibt in keinen
Bucket, also bleibt nur die Hervorhebung, und die ist kein Beweis.

**Wunsch:** `record('__E2E_FETCH_CALLS__', { cmd, url })` im Case
`fetch_external`.

## 7. Ein Download, der fehlschlagen kann

**Blockiert:** `models.retry-failed-downloads.click`,
`models.clear-this-failed-download-so-you-can-start-over.click`.

Beide Knoepfe erscheinen nur an einer Buendelkachel im Fehlerzustand.
`download_model` quittiert immer `started`, und `download_progress` meldet
jede gestartete Datei beim naechsten Abruf als `complete`. Der
`downloadStore` ist nicht persistiert, laesst sich also auch nicht ueber
localStorage in den Fehlerzustand seeden.

**Wunsch:** Option `failDownloads?: string[]` (Dateinamen), fuer die
`download_progress` `{ status: 'error', error: '...' }` meldet.

## 8. Ein erreichbares ComfyUI

**Blockiert:** `models.empty-category-discover.click`.

Der leere Kategoriezustand braucht installierte Modelle, aber keines in
der gewaehlten Kategorie. Bild- und Videomodelle zaehlt `useModels` live
aus einem laufenden ComfyUI auf (`/object_info`), und `comfyui_status` ist
im Mock ein fester Reject. Damit gibt es nie ein Bildmodell in der Liste,
und die Lage "es gibt Modelle, nur nicht hier" ist unbaubar.

**Wunsch:** `comfy.running?: boolean` plus eine Liste
`comfy.imageModels?: string[]`, die `comfyui_status` aufloesen und die
Enum-Abfrage bedienen. Das entsperrt vermutlich auch im Bereich create
einiges.

---

## Zwei Fallen, die keine Mock-Aenderung brauchen, aber dokumentiert gehoeren

**Der `lu-providers`-Seed muss `version: 1` tragen.** Der Store persistiert
auf Version 1 und bringt keine `migrate`-Funktion mit. Ein Blob mit
`version: 0` wird von zustand kommentarlos verworfen, der Spec laeuft dann
gegen die Standardanbieter und beweist etwas anderes als er behauptet.
Genau das ist in dieser Welle passiert und faellt nur auf, wenn man den
Store nach dem Booten zurueckliest.

**AppShell repariert eine kaputte Anbieterwelt beim Booten.** Die
Backend-Erkennung laeuft einmal pro Sitzung und schaltet jedes gefundene
Backend wieder ein und pinnt dessen `baseUrl`; da der Mock Ollamas
`/api/tags` immer beantwortet, wird Ollama immer gefunden. Wer eine Welt
mit ausgeschaltetem oder falsch adressiertem Ollama braucht, muss
`sessionStorage['lu-backend-detection-done'] = '1'` setzen, sonst heilt
sich die Welt vor dem ersten Klick. Steht als `pinProviders` in
`e2e/support/journeys/models.ts`.
