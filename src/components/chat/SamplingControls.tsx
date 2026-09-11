import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { DEFAULT_SETTINGS } from '../../lib/constants'
import { HINWEIS_TEXT } from '../../lib/hinweis'
import { useDismissOnEscape } from '../../hooks/useDismissOnEscape'

/**
 * Sampling controls next to the composer.
 *
 * The values already existed in settings and already reached the request; they
 * were just buried in the settings page, where nobody adjusts them per
 * conversation. Closed by default so the composer stays quiet.
 *
 * Every catalogue model accepts these parameters (measured 2026-09-10, no
 * request was rejected for one). Reasoning models accept them and react less,
 * which the help line says instead of hiding the control.
 *
 * ## Why this is a popup and not an inline panel
 *
 * David, 2026-09-11: "der sample anklickbar im prompt fenster muss ein pop up
 * sein, und nicht das prompt fenster veraendern. mit einem sauberen x zum
 * wegklicken und nicht einfach wieder auf den text klicken zum entfernen, soll
 * windows mac und webapp ueberall gleich sein."
 *
 * The first version rendered the fields as a sibling below the trigger, inside
 * the composer's flow. Opening them therefore grew the whole prompt window by
 * the height of the panel and pushed the text field down under the cursor,
 * which is the one thing the prompt window may not do. The panel is now taken
 * out of the flow (absolute, anchored to the top edge of the trigger, the same
 * placement the model picker next to it uses), so the row it hangs off keeps
 * its size and position to the pixel.
 *
 * Three rules follow from the same sentence, and the web app implements them
 * word for word:
 *   - closing is the X, or Escape, or a press outside. SAMPLING_CLOSE_LABEL is
 *     the accessible name of that button in BOTH apps.
 *   - the trigger opens and only opens. A second click on it used to make the
 *     panel vanish under the pointer, which is what "nicht einfach wieder auf
 *     den text klicken zum entfernen" asks to stop.
 *   - the keyboard goes into the popup when it opens and back to the trigger
 *     when it closes.
 */
const FIELDS = [
  { key: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.05 },
  { key: 'topP', label: 'Top P', min: 0, max: 1, step: 0.01 },
  { key: 'topK', label: 'Top K', min: 0, max: 200, step: 1 },
] as const

/**
 * Why "Max tokens" carries a draft string instead of the plain number.
 *
 * React keeps a controlled `<input type="number">` in step with a LOOSE
 * comparison (`node.value != value`). With a number on the prop side that
 * comparison coerces, so "0512" and 512 count as equal and the DOM keeps the
 * string it already had. Typing 512 into a field showing 0 therefore left
 * `0512` on screen forever, and the field looked like it appended instead of
 * replacing (measured on the box, T1 nebenfund 5). Handing React a STRING
 * turns the same comparison into a string comparison, so the normalised text
 * really lands in the DOM. The draft covers the other half: while the field is
 * focused an empty box must stay empty, otherwise nobody can clear it to type
 * a new number.
 */
export function normalizeMaxTokens(raw: string): number {
  if (raw.trim() === '') return DEFAULT_SETTINGS.maxTokens
  return Math.max(0, Math.trunc(Number(raw)) || 0)
}

/** The close button's accessible name. Word for word the same string as in the
 *  web app (apps/web/lib/sampling.ts), which a parity test there re-reads from
 *  this file: one close button on Windows, Mac and the web app. */
export const SAMPLING_CLOSE_LABEL = 'Close sampling settings'

/** What the popup is called for a screen reader. Same string in both apps. */
export const SAMPLING_DIALOG_LABEL = 'Sampling settings'

/** Panel width, in the same 248 px the web app gives it. */
const PANEL_WIDTH = 248

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function SamplingControls() {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.updateSettings)
  const changed = FIELDS.some((f) => settings[f.key] !== DEFAULT_SETTINGS[f.key])
    || settings.maxTokens !== DEFAULT_SETTINGS.maxTokens

  /** Give the keyboard back to the trigger, but only while it is still in the
   *  popup: on an outside press the browser is already moving it somewhere the
   *  user chose, and taking it back from them is worse than a lost menu.
   *
   *  The draft is dropped here as well, and that line is not redundant with the
   *  field's own onBlur. Measured 2026-09-11 against this component: an emptied
   *  Max tokens box survived every close path unless something moved the focus
   *  off the input first, because onBlur was the ONLY thing that cleared it.
   *  Today the focus move above happens to do that, so a real user never saw
   *  the stale box. That is luck, not a rule: whoever changes the focus rule
   *  next reopens the popup on an empty field while the store holds 0. The
   *  onBlur stays, because it covers the other half, leaving the field with the
   *  popup still open (Tab to Reset, grab a slider). */
  const close = useCallback(() => {
    const panel = panelRef.current
    if (panel && panel.contains(document.activeElement)) {
      wrapRef.current?.querySelector('button')?.focus()
    }
    setDraft(null)
    setOpen(false)
  }, [])

  const onEscape = useCallback(() => {
    close()
    wrapRef.current?.querySelector('button')?.focus()
  }, [close])
  useDismissOnEscape(open, onEscape)

  // pointerdown, not mousedown or click: a touch screen never sends mousedown
  // before the tap completes. The panel lives inside the wrapper, so one
  // containment test covers the trigger and the popup together.
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

  // The keyboard follows the popup. The X is the first control in it, which is
  // where a dialog's focus conventionally lands and, more to the point, is the
  // way out for someone who never reaches for Escape.
  useEffect(() => {
    if (!open) return
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
  }, [open])

  return (
    <div className="relative text-xs" ref={wrapRef} data-testid="sampling-controls">
      <button
        type="button"
        className="text-gray-500 hover:text-gray-300"
        aria-expanded={open}
        aria-controls={panelId}
        data-testid="sampling-trigger"
        // Opens, never closes. A trigger that also closed made the panel
        // disappear under the pointer on the second click.
        onClick={() => setOpen(true)}
      >
        Sampling: {settings.temperature.toFixed(2)}
        {/* Ein geaenderter Regler ist kein Zwischenfall, also traegt der
            Stern den ruhigen Ton und keine eigene Warnfarbe. */}
        {changed && <span className={`ml-1 ${HINWEIS_TEXT.ruhig}`} title="Changed from the defaults">*</span>}
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={SAMPLING_DIALOG_LABEL}
          data-testid="sampling-panel"
          // Placed with an inline style rather than utility classes, for the
          // same reason the web app does: `position` is then a fact a test can
          // read, instead of a class name a test would have to believe.
          style={{
            position: 'absolute',
            right: 0,
            bottom: '100%',
            marginBottom: 6,
            width: PANEL_WIDTH,
          }}
          className="z-50 space-y-2 rounded-lg p-2.5 lu-elevated"
        >
          <div className="flex justify-end">
            <button
              type="button"
              aria-label={SAMPLING_CLOSE_LABEL}
              title={SAMPLING_CLOSE_LABEL}
              data-testid="sampling-close"
              className="rounded p-0.5 text-gray-500 hover:text-gray-300"
              onClick={close}
            >
              <X size={11} />
            </button>
          </div>

          {FIELDS.map((f) => (
            <label key={f.key} className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-gray-400">{f.label}</span>
              <input
                type="range"
                className="min-w-0 flex-1"
                min={f.min}
                max={f.max}
                step={f.step}
                value={settings[f.key]}
                aria-label={f.label}
                onChange={(e) => update({ [f.key]: Number(e.target.value) })}
              />
              <span className="w-10 shrink-0 text-right tabular-nums text-gray-300">{settings[f.key]}</span>
            </label>
          ))}

          <label className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-gray-400">Max tokens</span>
            <input
              type="number"
              className="min-w-0 flex-1 rounded border border-gray-700 bg-transparent px-1 py-0.5"
              min={0}
              step={128}
              value={draft ?? String(settings.maxTokens)}
              aria-label="Max tokens"
              onChange={(e) => {
                const raw = e.target.value
                const next = normalizeMaxTokens(raw)
                setDraft(raw.trim() === '' ? raw : String(next))
                update({ maxTokens: next })
              }}
              onBlur={() => setDraft(null)}
            />
            <span className="w-10 shrink-0 text-right text-gray-500">{settings.maxTokens === 0 ? 'auto' : ''}</span>
          </label>

          <div className="flex items-center justify-between pt-1">
            <span className="text-gray-500">Reasoning models accept these and react less to them.</span>
            <button
              type="button"
              className="text-gray-400 underline disabled:opacity-40"
              disabled={!changed}
              onClick={() => {
                setDraft(null)
                update({
                  temperature: DEFAULT_SETTINGS.temperature,
                  topP: DEFAULT_SETTINGS.topP,
                  topK: DEFAULT_SETTINGS.topK,
                  maxTokens: DEFAULT_SETTINGS.maxTokens,
                })
              }}
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
