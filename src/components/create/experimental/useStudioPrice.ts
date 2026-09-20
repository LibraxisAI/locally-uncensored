// Der Preis eines Studio-Laufs im Create-Tab.
//
// Port aus dem Web (components/create/experimental/useStudioPrice.ts), mit
// EINEM bewussten Unterschied (Portplan P7, Abschnitt 5 Punkt 3): das Web
// faellt bei jedem Fehler still auf die eigene Formel zurueck und laesst den
// Startknopf offen ("die eigene Formel traegt die Anzeige weiter"). Der
// Desktop-Client spricht den Anbieter zum ERSTEN Mal ueberhaupt ueber CORS an
// (P0 im Web-Repo ist die Vorbedingung dafuer, siehe studio.ts) und darf
// deshalb nicht optimistisch sein: bleibt der Server unerreichbar oder zu alt,
// bleibt der Startknopf gesperrt und zeigt den festen englischen Text aus
// studio.ts, statt einen Lauf zuzulassen, den der Server beim Buchen doch
// ablehnt (Portplan Abschnitt 7, Risiko 1+2).
//
// Auf der LOKALEN Spur (ComfyUI/MLX) darf dieser Hook keinen einzigen
// Netzabruf ausloesen: `model` ist dort immer undefined (Composer uebergibt
// `studioPick`, das nur bei `backend === 'cloud'` gesetzt wird), und der
// Effekt unten kehrt in dem Fall sofort um, ohne `studioQuote()` zu rufen.
// Siehe useCloudCreate-studio.test.ts, Fall "no network call on the local
// lane".
//
// Review A1/B3 (Runde 2, 20.09.2026): `price.mode` 'input'/'both' Modelle
// (pricesByInput()) bleiben hier weiterhin bei der Formel-Vorschau, OHNE
// `studioQuote()`, das ist bewusst, nicht die Luecke, die B3 fand. Diese
// Modelle rechnen serverseitig aus der GEMESSENEN Laenge der hochgeladenen
// Datei; eine echte Server-Quote vor dem Klick wuerde die Datei hochladen,
// bevor die Kundschaft ueberhaupt "Create" gedrueckt hat, fuer eine Zahl, die
// sie vielleicht nie sieht. Die Geldwahrheit liegt fuer diese 17 Modelle
// stattdessen in `useCloudCreate.ts`: `generate()` ruft `studioQuote()` MIT
// den bereits fuer den Lauf hochgeladenen Pfaden, unmittelbar vor der
// Buchung, und setzt genau diese Zahl als `max_credits`, kein Upload extra,
// kein Kredit ohne bestaetigte Zahl. Der Startknopf bleibt fuer diese 17
// deshalb nicht wegen eines fehlenden Preises gesperrt (er war es nie fuer
// price.mode 'output'/'characters' Modelle vor dem ersten Tastendruck
// entweder), sondern die Buchung selbst kann nie mehr Kredite abrechnen, als
// die Quote unmittelbar davor bestaetigt.

import { useEffect, useRef, useState } from 'react'
import { createStudioCost, pricesByInput } from '../../../lib/render/create-studio'
import { studioQuote } from '../../../api/cloud/studio'
import { StudioQuoteChangedError } from '../../../api/cloud/studio'
import { CloudJobError } from '../../../api/cloud/client'

/** Laenge einer Ton- oder Bildspur, im Browser gemessen. */
export function mediaSeconds(url: string, kind: 'audio' | 'video'): Promise<number | undefined> {
  return new Promise((resolve) => {
    const el = document.createElement(kind)
    const done = (v?: number) => { el.src = ''; resolve(v) }
    el.preload = 'metadata'
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : undefined)
    el.onerror = () => done(undefined)
    // Ein Medium, das sich nicht oeffnen laesst, darf die Anzeige nicht anhalten.
    setTimeout(() => done(undefined), 8000)
    el.src = url
  })
}

export interface StudioPrice {
  credits: number
  /** Wahr, sobald die Zahl vom Anbieter bestaetigt ist. */
  live: boolean
  /** Gesetzt, wenn der Anbieter nicht erreichbar ist oder der Server das
   *  Studio noch nicht kennt (siehe studio.ts, OLDER_SERVER_MESSAGE). Solange
   *  das steht, darf der Startknopf nicht freigeben, Portplan Abschnitt 5. */
  error?: string
}

export function useStudioPrice(
  model: string | undefined,
  options: Record<string, unknown>,
  prompt: string,
  seconds: number | undefined,
): StudioPrice | null {
  const [live, setLive] = useState<{ key: string; credits: number } | null>(null)
  const [error, setError] = useState<{ key: string; message: string } | null>(null)
  const abort = useRef<AbortController | null>(null)
  const key = model ? JSON.stringify([model, options, prompt.length, seconds]) : ''

  useEffect(() => {
    abort.current?.abort()
    // Kein Modell (lokale Spur, oder Wolke ohne Studio-Wahl): kein Abruf.
    // Ein Modell, dessen Preis an einer hochgeladenen Datei haengt, wird erst
    // MIT der Datei gebucht (useCloudCreate), hier reicht die Formel.
    if (!model || pricesByInput(model)) { setLive(null); setError(null); return }
    const controller = new AbortController()
    abort.current = controller
    const timer = setTimeout(async () => {
      try {
        const res = await studioQuote(model, prompt, { op: 'studio', studio_options: options })
        if (controller.signal.aborted) return
        setLive({ key, credits: res.credits })
        setError(null)
      } catch (err) {
        if (controller.signal.aborted) return
        if (err instanceof StudioQuoteChangedError) {
          // 409 quote_changed: zeigt den neuen Preis, statt still weiter die
          // alte Formel zu zeigen oder gar neu zu buchen.
          setLive({ key, credits: err.credits })
          setError(null)
          return
        }
        if (err instanceof CloudJobError) {
          setError({ key, message: err.message })
          setLive(null)
          return
        }
        // Unerwarteter Fehler (kein CloudJobError): nicht verschlucken, aber
        // auch nicht den Startknopf sperren, dafuer fehlt die Textgrundlage.
        setLive(null)
        setError(null)
      }
    }, 500)
    return () => { clearTimeout(timer); controller.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (!model) return null
  if (error && error.key === key) {
    return { credits: createStudioCost(model, options, Array.from(prompt).length, seconds), live: false, error: error.message }
  }
  if (live && live.key === key) return { credits: live.credits, live: true }
  return { credits: createStudioCost(model, options, Array.from(prompt).length, seconds), live: false }
}
