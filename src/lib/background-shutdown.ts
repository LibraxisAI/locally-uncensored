/**
 * B1 Nachbesserung 1 (Opus-Review, 3.0.1) - der Orchestrator-Entscheid "Stop
 * heisst Stop" galt von Anfang an fuer fuenf Ausloeser: der Stop-Knopf,
 * Abmelden, Fenster schliessen, App beenden, Netzabbruch. Gebaut war nur der
 * erste. Ohne die anderen vier feuert ein delegate_task-Hintergrundagent
 * weiter, nachdem der Nutzer sich abgemeldet hat - mit einem Konto, das er
 * gerade verlassen hat glaubt. Das ist die teuerste der vier Luecken.
 *
 * `stopAllBackgroundWork()` ist die eine Stelle: sie laeuft ueber jede
 * Konversation im Aufgaben-Store und wendet dasselbe Paar an, das der
 * Stop-Knopf selbst benutzt (useAgentTaskStore.cancelAll + lib/run-stop's
 * stopRun) - kein neuer Mechanismus, nur derselbe an vier weiteren Stellen.
 * `stopRun` ist wichtig und nicht nur `cancelAll`: ohne den klebrigen Merker
 * wuerde ein Hintergrundagent, der GENAU IN DEM MOMENT gestartet wird (siehe
 * die Wettlauf-Nachbesserung in api/agents/sub-agent.ts), den Ausloeser
 * verpassen.
 */
import { useAgentTaskStore } from '../stores/agentTaskStore'
import { stopRun } from './run-stop'
import { isTauri } from '../api/backend'

/**
 * Bricht jede laufende Hintergrundaufgabe in jeder Konversation ab und setzt
 * den Stop-Merker fuer jede von ihnen - unabhaengig davon, welche
 * Konversation gerade sichtbar ist. Kein Ausloeser hier kennt "die aktive
 * Konversation": das Abmelden, das Schliessen und der Netzabbruch treffen
 * die ganze Sitzung, nicht nur den gerade offenen Tab.
 */
export function stopAllBackgroundWork(): void {
  const byConv = useAgentTaskStore.getState().byConv
  for (const convId of Object.keys(byConv)) {
    useAgentTaskStore.getState().cancelAll(convId)
    stopRun(convId)
  }
}

/** Die von `installBackgroundShutdown` gesetzten Horcher, fuer Idempotenz. */
let installed: (() => void) | null = null

/**
 * Haengt `stopAllBackgroundWork` an die drei Ausloeser, die kein Knopf im UI
 * sind: App beenden, Fenster schliessen, Netzabbruch (Abmelden ruft die
 * Funktion direkt aus `signOutAccount`, siehe hooks/useCloudAuth.ts).
 *
 * ── App beenden ─────────────────────────────────────────────────────────
 * `pagehide` + `beforeunload`, exakt das Paar aus api/mcp/shutdown.ts und
 * aus denselben Gruenden: `pagehide` feuert zuverlaessig beim Verschwinden
 * der Webview in WebKit/WebView2 (Cmd+Q, Tray-Quit und `exit_app` reissen
 * alle die Webview mit), `beforeunload` ist der frueheste der beiden und
 * kostet nichts extra, weil `stopAllBackgroundWork` mehrfach aufzurufen
 * harmlos ist (cancelAll auf einer bereits leeren/abgebrochenen Liste tut
 * nichts). Im Browser-Dev-Build ist das dasselbe Ereignis wie ein
 * Tab-Schliessen - genau der in Punkt 1 verlangte Rueckfall.
 *
 * ── Fenster schliessen ──────────────────────────────────────────────────
 * BEWUSST NICHT an Tauris `onCloseRequested` gehaengt, obwohl der
 * Nachbesserungs-Auftrag genau das nennt. Grund: in main.rs (Zeile ~760)
 * ruft der Rust-Handler bei jedem X-Klick `api.prevent_close()` und
 * versteckt das Fenster in den Tray, statt die App zu beenden - das X
 * schliesst hier nichts, es minimiert. Ein `onCloseRequested`-Horcher in
 * diesem Modul wuerde bei JEDEM Klick auf das X feuern, also auch beim
 * blossen Wegklicken in den Tray, und braeche damit genau die
 * Hintergrundagenten ab, die der Sinn des Tray-Verhaltens sind ("die App
 * arbeitet weiter, waehrend das Fenster weg ist"). main.rs sendet fuer
 * exakt diesen Moment bereits ein eigenes Ereignis an die Oberflaeche,
 * `app:hidden` - useVoice.ts hoert bereits darauf, um Mikro und Wiedergabe
 * zu stoppen, aus derselben Ueberlegung ("die Webview lebt weiter, obwohl
 * der Nutzer glaubt, das Fenster sei weg"). Dieses Modul hoert auf dasselbe
 * Ereignis, statt ein zweites fuer denselben Augenblick zu registrieren.
 *
 * ── Netzabbruch ─────────────────────────────────────────────────────────
 * `window.addEventListener('offline', ...)` - ein abgebrochener
 * Hintergrundagent, der sowieso nicht mehr senden kann, feuert wenigstens
 * das Panel und den Merker korrekt, statt still auf eine Verbindung zu
 * warten, die nicht wiederkommt, ohne dass der Nutzer es sehen kann.
 *
 * Idempotent wie installMcpShutdown: mehrfacher Aufruf installiert nur einen
 * Satz Horcher.
 */
export function installBackgroundShutdown(): () => void {
  if (installed) return installed
  if (typeof window === 'undefined') return () => {}

  const onGone = () => stopAllBackgroundWork()
  window.addEventListener('pagehide', onGone)
  window.addEventListener('beforeunload', onGone)
  window.addEventListener('offline', onGone)

  let unlistenHidden: (() => void) | undefined
  if (isTauri()) {
    void (async () => {
      const { listen } = await import('@tauri-apps/api/event')
      unlistenHidden = await listen('app:hidden', onGone)
    })()
  }

  installed = () => {
    window.removeEventListener('pagehide', onGone)
    window.removeEventListener('beforeunload', onGone)
    window.removeEventListener('offline', onGone)
    unlistenHidden?.()
    installed = null
  }
  return installed
}

/** Test-only: die Horcher sind Modulzustand fuer die ganze Sitzung, mit Absicht. */
export function __resetBackgroundShutdownForTests(): void {
  installed?.()
}
