# Mock-Wuensche: onboarding, auth, release

Welle vom 20.08.2026. Jeder Punkt blockiert konkrete ids, die sonst
beweisbar waeren. Reihenfolge nach Ertrag.

## 1. Eine Box, auf der KEIN Backend laeuft

**Blockiert 6 ids:** `onboarding.backends.install-ollama`,
`.install-lmstudio`, `.rescan-empty`, `.open-backend-website`,
`.continue-without-backend`, `.start-lmstudio-server`.

`proxy_localhost` beantwortet jede URL, die `11434` enthaelt oder auf
`/tags` endet, mit einer Modelliste (tauri-mock.ts, case
`proxy_localhost`). `probeBackend` (src/lib/backend-detector.ts:40)
braucht nur `res.ok`, und `localFetch` verpackt jede aufgeloeste
Proxy-Antwort in eine 200. Ergebnis: Ollama ist in JEDER Welt
erreichbar, auch in der, die MOCK-NOTES.md als frische Box beschreibt.

Der ganze Zweig `detectedBackends.length === 0` im Backend-Schritt ist
damit unerreichbar, und das ist der Zweig, in dem die App einem Neuling
ueberhaupt erst ein Backend besorgt.

Vorschlag: eine Option `sys.ollamaReachable?: boolean` (Default true,
damit kein bestehender Spec kippt). Bei `false` lehnt `proxy_localhost`
die 11434-URLs mit `connection refused (e2e)` ab, genau wie jeden
anderen Port. Alternativ allgemeiner: `reachablePorts?: number[]`.

## 2. Ein zweites erreichbares Backend

**Blockiert 4 ids:** alle vier `onboarding.backend-selector.*`.

Der Auswahldialog nach dem Onboarding oeffnet erst ab ZWEI gefundenen
Backends (AppShell.tsx:775, `if (backends.length === 1) return`). Der
Mock kann nur Ollama erreichbar machen, jede andere Portanfrage wird
abgelehnt, deshalb ist der Dialog nicht zu oeffnen.

Vorschlag: `proxy_localhost` beantwortet `/v1/models` fuer eine per
Option freigegebene Portliste mit `{"object":"list","data":[]}`, zum
Beispiel `sys.openaiCompatPorts?: number[]`. Mit `[1234]` wird LM Studio
zusaetzlich erkannt und der Dialog erscheint mit zwei Zeilen.

## 3. Installer, die scheitern koennen

**Blockiert 1 id:** `onboarding.backends.start-lmstudio-server`.

`install_lmstudio_status` (und die Geschwister fuer Ollama und Python)
kennen nur `idle`, `downloading` und `complete`. Der Knopf Start LM
Studio server steht ausschliesslich unter einer Fehlermeldung, die
`didn't come up` enthaelt, und diese Meldung ist im Mock nicht
herstellbar.

Vorschlag: `sys.installFailures?: { ollama?: string; lmstudio?: string;
python?: string }`. Ist ein Eintrag gesetzt, endet der Slot nach den
zwei ueblichen Polls auf `status: 'error'` mit dem Text als letzter
Logzeile. Fuer diesen Fall genuegt
`{ lmstudio: "LM Studio server didn't come up on :1234" }`.

## 4. Ein OAuth-Callback, der wartet

**Blockiert 1 id:** `auth.oauth.cancel-browser-wait`. Schwaecht
zusaetzlich den Beweis fuer `auth.oauth.sign-in-google` und
`.sign-in-github`, deren zugesagter Spinner- und Sperrzustand nicht
pruefbar ist.

`oauth_wait` loest sofort mit der Ablehnung auf, damit kein Spec 300 s
haengt. Richtig so, aber die Zeile `Waiting for the browser… Cancel`
lebt dadurch nur einen Tick.

Vorschlag: `oauthWaitDelayMs?: number` (Default 0). Bei einem Wert
groesser 0 antwortet `oauth_wait` erst nach dieser Zeit. Damit ist der
Wartezustand sichtbar, der Cancel-Knopf klickbar, und der Abbruch
messbar: `loginWithProvider` rennt in `Sign-in cancelled.` und die
Anbieterknoepfe sind wieder frei.

## 5. Fensterkommandos aufzeichnen

**Blockiert 3 ids:** `onboarding.close.click`, `.minimize.click`,
`.maximize.click`. (Betrifft ausserhalb dieses Bereichs auch die
Titelleiste der laufenden App.)

`getCurrentWindow().minimize()` und Geschwister landen als
`plugin:window|minimize` / `|toggle_maximize` / `|close` im
default-Zweig des Routers, der still `0` zurueckgibt. Es gibt keine
pruefbare Wirkung, nur einen Klick ins Leere.

Vorschlag: im default-Zweig, analog zu `plugin:shell|open`, jedes
`plugin:window|*` nach `__E2E_WINDOW_CALLS__` schreiben (`{ cmd }`
genuegt). Dann ist die Wirkung dieser drei Knoepfe genau so beweisbar
wie die des Systembrowsers.

## Nicht der Mock, sondern die App

`onboarding.models.filter-unfiltered` und `.filter-mainstream` sind
blockiert, aber ohne Mock-Wunsch: `ONBOARDING_MODELS`
(src/lib/constants.ts:319) hat seit P4 genau einen mainstream-Eintrag,
und der Reiterblock rendert nur, wenn beide Kategorien besetzt sind
(Onboarding.tsx:1591). Die zwei Knoepfe existieren im laufenden Build
nirgends. Entscheidung fuer David: Starterliste wieder fuellen oder die
Reiter loeschen.

## Anmerkung zum Harness

Die Specs dieses Bereichs schneiden die Vite-HMR-Verbindung ab
(`muteHmr` in e2e/support/journeys/onboarding.ts). Grund: der
Dev-Server laeuft gegen eine lebende Arbeitskopie, und jeder Speichern
unter `src/` schickt der Seite einen Full-Reload. Der Assistent ist die
laengste Reise der Suite (zwei gepollte Installer hintereinander), ein
Reload wirft ihn auf den Willkommensschritt zurueck und loescht die
aufgezeichneten invokes. Am Verhalten der App aendert das nichts, der
Reload-Kanal existiert in einem gebauten Build nicht. Falls der
Dirigent das zentral will, gehoert es besser in die
playwright.config.ts als in jeden Bereich einzeln.
