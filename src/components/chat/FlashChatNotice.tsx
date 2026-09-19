import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useModelStore } from '../../stores/modelStore'
import { clearFlashNotices, useFlashBillingStore } from '../../lib/flash-ui'
import { FLASH_UNPAID_NOTICE, useFlashEntitlement } from '../../lib/flash-entitlement'
import { useDismissOnEscape } from '../../hooks/useDismissOnEscape'
import { TOOLBAR_LABEL_TEXT } from './AgentModeToggle'

/**
 * Was eine Runde auf dem gewaehlten Modell dieses Konto kostet, als kleiner
 * Hinweis in der Sitzungsleiste statt als stehendes Band ueber der Eingabe.
 *
 * David, 19.09.2026: das alte Band stand dauerhaft ueber dem Eingabefeld, sah
 * schlecht aus und schob den Agent-Schalter, die Kontextanzeige und Memories
 * nach oben. Der Hinweis ist jetzt ein einzeiliges Etikett neben dem
 * Agent-Schalter, das ein Popup oeffnet statt Platz zu beanspruchen. Bauart
 * wortgleich mit `SamplingControls`, dem Haus-Muster fuer genau dieses Popup
 * (Trigger oeffnet, Escape/X/Aussenklick schliessen, Fokus geht rein und
 * zurueck), damit nicht ein zweites Muster fuer dasselbe Verhalten entsteht.
 *
 * Runde 2 (19.09.2026, derselbe Tag): drei Nachbesserungen aus der Abnahme,
 * plus ein Nachtrag desselben Tages.
 *   1. Die gruene "No credits"-Marke UEBER dem Eingabefeld ist weg, dieses
 *      Etikett hier ersetzt sie. Der Nachtrag ging weiter: die ganze Zeile
 *      ueber dem Eingabefeld (auch "No refusals") ist geloescht, nicht nur
 *      entkoppelt. In der Modellauswahl selbst bleiben beide Marken stehen
 *      (`ModelRowMarks.tsx`, unberuehrt, siehe `ModelSelector.tsx`).
 *   2. Das Popup hatte einen leeren Streifen ohne sichtbares X und neun Saetze
 *      Fliesstext. Es traegt jetzt eine kleine Ueberschrift, die den Zustand
 *      benennt, das X liegt sichtbar daneben, und die Bedingungen stehen als
 *      kurze Liste statt als Absatz. Keine Bedingung ist dabei weggefallen,
 *      nur knapper gefasst; was sich nicht in eine Zeile bringen liess (die
 *      Reservierungsregel) steht als letzter kleiner Absatz darunter.
 *   3. Der Trigger traegt jetzt dieselbe Schriftgroesse wie "Agent" daneben:
 *      `TOOLBAR_LABEL_TEXT` aus `AgentModeToggle.tsx` (vorher `t-micro` =
 *      10px, sichtbar groesser als die 8,8px des Nachbarn) und
 *      `aria-haspopup="dialog"`. Geteilte Konstante statt einer zweiten
 *      Kopie derselben arbitraeren Schriftgroesse, siehe der Kommentar an
 *      der Konstante: `die-typo-leiter-und-ihre-umgehung.test.ts` deckelt
 *      genau das.
 *   4. Bei schmalem Fenster lief das Panel mit festem `left: 0` rechts aus dem
 *      Fenster (Screenshot der ersten Runde, rechts abgeschnitten). `left`
 *      wird jetzt aus der Fensterbreite berechnet (`clampNoticeLeft`, pure und
 *      damit ohne DOM testbar) und bei jedem Resize neu gemessen, solange das
 *      Panel offen ist. Bleibt `position: absolute`, wie zuvor: kein Portal
 *      noetig, diese App hat keinen Zoom-Wrapper, den ein Portal umgehen
 *      muesste.
 *
 * Zwei Sorten Text leben hier und verhalten sich mit Absicht verschieden:
 *   - die Zeilen je Anfrage melden eine Antwort, die schon zurueck ist. Sie
 *     veralten, sobald diese Oberflaeche weg ist, also raeumen Fokus und Blur
 *     sie ab.
 *   - der stehende Satz darueber beschreibt das gewaehlte Modell und den Plan
 *     dieses Kontos. Das veraltet durch einen Blur nicht, er bleibt stehen.
 *     Seine Kontohaelfte kommt aus dem Kontospeicher, den `useCloudAuth` im
 *     Takt aus `/api/me` nachzieht.
 *
 * Das Etikett selbst traegt die Farbe: GRUEN nur, wenn diese Runde wirklich
 * keine Credits kostet (bezahlter Plan, Freimenge nicht aufgebraucht). Faellt
 * die Anfrage auf Credits zurueck (Freimenge aufgebraucht) oder zahlt das
 * Konto ohnehin fuer dieses Modell (kein bezahlter Plan), steht an derselben
 * Stelle derselbe neutrale Text, nie Gruen: eine falsche Zusage waere hier
 * schlimmer als keine.
 */

const FOCUSABLE = 'button:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Panel width, matching the sampling popup's own fixed width class of sizes. */
const PANEL_WIDTH = 280

/** Breathing room kept between the panel and the window edge. */
const PANEL_MARGIN = 8

/** The close button's accessible name, mirrored in the web app. */
export const FLASH_NOTICE_CLOSE_LABEL = 'Close Flash usage details'

/** What the popup is called for a screen reader, mirrored in the web app. */
export const FLASH_NOTICE_DIALOG_LABEL = 'Flash usage'

/** The trigger's own label per state, mirrored in the web app. */
export const FLASH_NOTICE_LABEL_FREE = 'Using no credits'
export const FLASH_NOTICE_LABEL_CREDITS = 'Using credits'

/** The popup's own heading per state, mirrored in the web app: names WHY the
 *  trigger reads what it reads, instead of leaving the reader to infer it
 *  from a wall of text. */
export const FLASH_NOTICE_HEADING_FREE = 'Flash models use no credits'
export const FLASH_NOTICE_HEADING_UNPAID = 'Flash models need a paid plan'
export const FLASH_NOTICE_HEADING_EXHAUSTED = "Today's free allowance is used"

/**
 * Where the panel's left edge lands, clamped into the window.
 *
 * The trigger sits near the LEFT of a narrow session strip, so the panel's
 * natural anchor is `left: 0` (its own left edge flush with the trigger's).
 * That ran the panel off the right side of a narrow window, because nothing
 * ever asked how wide the window actually was. Pure function so the clamp
 * itself is testable without mounting a DOM.
 */
export function clampNoticeLeft(wrapLeft: number, viewportWidth: number, wanted: number): { left: number; width: number } {
  const width = Math.min(wanted, Math.max(viewportWidth - PANEL_MARGIN * 2, 0))
  const naturalViewportLeft = wrapLeft // left: 0 means "flush with the trigger"
  const clampedViewportLeft = Math.min(
    Math.max(naturalViewportLeft, PANEL_MARGIN),
    Math.max(viewportWidth - width - PANEL_MARGIN, PANEL_MARGIN),
  )
  return { left: clampedViewportLeft - wrapLeft, width }
}

export function FlashChatNotice() {
  useEffect(() => {
    // Another tab can change the account while this surface is unfocused.
    window.addEventListener('blur', clearFlashNotices)
    window.addEventListener('focus', clearFlashNotices)
    return () => {
      window.removeEventListener('blur', clearFlashNotices)
      window.removeEventListener('focus', clearFlashNotices)
      clearFlashNotices()
    }
  }, [])

  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const headingId = useId()
  const [panelBox, setPanelBox] = useState<{ left: number; width: number }>({ left: 0, width: PANEL_WIDTH })

  const active = useModelStore((s) => s.models.find((m) => m.name === s.activeModel))
  const policy = active && 'flash' in active ? active.flash : undefined
  const notice = useFlashBillingStore((s) => (policy ? s.entries[policy.billingKey] : undefined))
  const paidPlan = useFlashEntitlement()

  // Give the keyboard back to the trigger, but only while it is still in the
  // popup: on an outside press the browser is already moving it somewhere the
  // user chose. Same rule as SamplingControls.close.
  const close = useCallback(() => {
    const panel = panelRef.current
    if (panel && panel.contains(document.activeElement)) {
      wrapRef.current?.querySelector('button')?.focus()
    }
    setOpen(false)
  }, [])
  useDismissOnEscape(open, close)

  useEffect(() => {
    if (!open) return
    const aus = (e: Event) => {
      const target = e.target as Node | null
      if (!target) return
      if (wrapRef.current?.contains(target)) return
      close()
    }
    document.addEventListener('pointerdown', aus)
    return () => document.removeEventListener('pointerdown', aus)
  }, [open, close])

  useEffect(() => {
    if (!open) return
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
  }, [open])

  // Measured once on open and again on every resize while open, so a window
  // dragged narrower while the popup is up never leaves it hanging off the
  // edge either.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = wrapRef.current?.getBoundingClientRect()
      if (!rect) return
      setPanelBox(clampNoticeLeft(rect.left, window.innerWidth, PANEL_WIDTH))
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])

  if (!policy) return null
  // Noch nicht beantwortet. Schweigen ist der einzige ehrliche Zustand: beide
  // Saetze im Popup sind Aussagen ueber Geld.
  if (paidPlan === null) return null

  // Gruen ist nur wahr, solange diese Runde wirklich nichts kostet: ein
  // bezahlter Plan UND keine bereits gemeldete Rueckkehr auf Credits.
  const usesCredits = !paidPlan || notice?.billing === 'credits'
  const label = usesCredits ? FLASH_NOTICE_LABEL_CREDITS : FLASH_NOTICE_LABEL_FREE
  const heading = !paidPlan
    ? FLASH_NOTICE_HEADING_UNPAID
    : notice?.billing === 'credits'
      ? FLASH_NOTICE_HEADING_EXHAUSTED
      : FLASH_NOTICE_HEADING_FREE

  return (
    <div className="relative shrink-0" ref={wrapRef} data-testid="flash-chat-notice">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={panelId}
        data-testid="flash-chat-notice-trigger"
        title="Flash usage for this chat"
        // Dieselbe Schriftgroesse und Grundlinie wie "Agent" daneben
        // (AgentModeToggle.tsx), damit die beiden Etiketten in der Leiste wie
        // ein Satz aussehen statt wie zwei verschiedene Schriften.
        className={
          usesCredits
            ? `${TOOLBAR_LABEL_TEXT} whitespace-nowrap text-gray-500 hover:text-gray-300 transition-colors`
            : `${TOOLBAR_LABEL_TEXT} whitespace-nowrap text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 transition-colors`
        }
        onClick={() => setOpen(true)}
      >
        {label}
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-labelledby={headingId}
          aria-label={FLASH_NOTICE_DIALOG_LABEL}
          data-testid="flash-chat-notice-panel"
          // Out of flow, exactly like SamplingControls: the row it hangs off
          // keeps its size and position to the pixel, whatever this says.
          style={{
            position: 'absolute',
            left: panelBox.left,
            top: '100%',
            marginTop: 6,
            width: panelBox.width,
          }}
          className="z-50 rounded-lg p-2.5 lu-elevated text-xs text-gray-500"
        >
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h2 id={headingId} className="text-xs font-semibold text-gray-700 dark:text-gray-200">
              {heading}
            </h2>
            <button
              type="button"
              aria-label={FLASH_NOTICE_CLOSE_LABEL}
              title={FLASH_NOTICE_CLOSE_LABEL}
              data-testid="flash-chat-notice-close"
              className="shrink-0 rounded p-0.5 text-gray-500 hover:text-gray-300"
              onClick={close}
            >
              <X size={13} />
            </button>
          </div>

          {!paidPlan ? (
            <p>{FLASH_UNPAID_NOTICE}</p>
          ) : (
            <>
              <ul className="list-disc space-y-1 pl-4">
                <li>
                  {policy.dailyTokens.toLocaleString('en-US')} input and output tokens per day, free of credits.
                  Resets at 00:00 UTC.
                </li>
                <li>One free request at a time per account.</li>
                <li>API keys always use credits.</li>
                <li>A request beyond the allowance uses credits instead.</li>
                <li>
                  Free requests: up to {policy.defaultMaxOutput.toLocaleString('en-US')} output tokens,{' '}
                  {policy.requestSeconds} seconds.
                </li>
              </ul>
              <p className="mt-1.5">
                The request budget is reserved before generation. A failed or interrupted request without final
                usage keeps that reservation.
              </p>
              {notice?.billing === 'credits' && (
                <p role="alert" className="mt-1.5 text-gray-700 dark:text-gray-200">
                  {notice.ok ? 'This request uses credits instead of the free Flash allowance.' : 'This request requires credits. No generation started.'}
                  {' '}Its token budget exceeds the available allowance.
                </p>
              )}
              {notice?.billing === 'flash' && (
                <p role="status" className="mt-1.5">
                  Free Flash request. Remaining after reservation: {notice.remaining.toLocaleString('en-US')} tokens.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
