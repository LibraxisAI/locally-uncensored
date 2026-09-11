import { useState } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { DEFAULT_SETTINGS } from '../../lib/constants'
import { HINWEIS_TEXT } from '../../lib/hinweis'

/**
 * Sampling controls next to the composer.
 *
 * The values already existed in settings and already reached the request; they
 * were just buried in the settings page, where nobody adjusts them per
 * conversation. Collapsed by default so the composer stays quiet.
 *
 * Every catalogue model accepts these parameters (measured 2026-09-10, no
 * request was rejected for one). Reasoning models accept them and react less,
 * which the help line says instead of hiding the control.
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

export function SamplingControls() {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.updateSettings)
  const changed = FIELDS.some((f) => settings[f.key] !== DEFAULT_SETTINGS[f.key])
    || settings.maxTokens !== DEFAULT_SETTINGS.maxTokens

  return (
    <div className="text-xs" data-testid="sampling-controls">
      <button
        type="button"
        className="text-gray-500 hover:text-gray-300"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Sampling: {settings.temperature.toFixed(2)}
        {/* Ein geaenderter Regler ist kein Zwischenfall, also traegt der
            Stern den ruhigen Ton und keine eigene Warnfarbe. */}
        {changed && <span className={`ml-1 ${HINWEIS_TEXT.ruhig}`} title="Changed from the defaults">*</span>}
      </button>

      {open && (
        <div className="mt-2 space-y-2 rounded border border-gray-700 p-2" data-testid="sampling-panel">
          {FIELDS.map((f) => (
            <label key={f.key} className="flex items-center gap-2">
              <span className="w-20 text-gray-400">{f.label}</span>
              <input
                type="range"
                className="flex-1"
                min={f.min}
                max={f.max}
                step={f.step}
                value={settings[f.key]}
                aria-label={f.label}
                onChange={(e) => update({ [f.key]: Number(e.target.value) })}
              />
              <span className="w-10 text-right tabular-nums text-gray-300">{settings[f.key]}</span>
            </label>
          ))}

          <label className="flex items-center gap-2">
            <span className="w-20 text-gray-400">Max tokens</span>
            <input
              type="number"
              className="flex-1 rounded border border-gray-700 bg-transparent px-1 py-0.5"
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
            <span className="w-10 text-right text-gray-500">{settings.maxTokens === 0 ? 'auto' : ''}</span>
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
