/**
 * "LU Engine is missing from your providers."
 *
 * R13D Nebenfund 1 (3.0.1 box-gruen r13d, 2026-09-21): add two custom local
 * OpenAI-compatible providers in a row and remove both again, and LU Engine
 * falls out of the `openai` slot entirely, with no card and no restart
 * bringing it back. Root cause and the pure read of the slot both live in
 * `lib/builtin-engine-presence.ts`; this bar is only the composer-side
 * notice, same place RetrievalErrorBar and LuEngineSwitchBar already stand.
 *
 * Opus review, first round: `isBuiltinEngineMissing` alone is a false
 * positive for a customer who picked a different local backend on purpose
 * (onboarding, the startup backend selector, Start LM Studio Server), and
 * the notice used to claim "Local chat will not answer until it is back",
 * which is false whenever that other backend is the one actually holding
 * the slot. Fixed by reading `providerStore.engineOptedOut` (set only by
 * those deliberate pick UIs) and by dropping the claim about local chat
 * failing: this notice is about LU ENGINE specifically being gone, not
 * about whether local chat works at all.
 *
 * Shown only in Local mode: in Cloud mode the local slot is not on the path
 * the user's messages take, so the notice would be true but pointless there.
 * The Settings, AI Backends, Providers list carries the same check without
 * that gate, since the provider list itself is wrong regardless of mode.
 *
 * No Restore button here: the action that fixes this (`selectPreset` in
 * `ProviderConfig.tsx`, which also asks before a key loss) is local to that
 * component, not a handful of lines to reuse from outside it. The Settings
 * banner carries the button; this one names the path instead.
 *
 * Dismissal is session-only, not persisted: it resets the moment the engine
 * is back, so it never hides a standing problem across a restart.
 */
import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Hinweis } from '../ui/Hinweis'
import { useProviderStore } from '../../stores/providerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { isBuiltinEngineMissing } from '../../lib/builtin-engine-presence'

export function EngineMissingBar() {
  const openaiSlot = useProviderStore((s) => s.providers.openai)
  const engineOptedOut = useProviderStore((s) => s.engineOptedOut)
  const appMode = useSettingsStore((s) => s.settings.appMode)
  const missing = appMode === 'local' && isBuiltinEngineMissing(openaiSlot, engineOptedOut)
  const [dismissed, setDismissed] = useState(false)
  // Reset the dismissal the moment the condition itself changes, adjusted
  // during render rather than in an effect (react-hooks/set-state-in-effect):
  // this is the "state that resets when a prop changes" case the React docs
  // call out, not a cascading-render trap. It keeps a dismissed notice from
  // hiding a DIFFERENT missing-engine episode than the one the user dismissed.
  const [wasMissing, setWasMissing] = useState(missing)
  if (missing !== wasMissing) {
    setWasMissing(missing)
    if (!missing) setDismissed(false)
  }

  if (!missing || dismissed) return null

  return (
    <div data-testid="engine-missing-bar" className="mx-3 mb-1.5">
      <Hinweis
        ton="fehler"
        icon={<AlertTriangle size={11} className="shrink-0 mt-0.5" />}
        onDismiss={() => setDismissed(true)}
      >
        LU Engine is missing from your providers. Add Provider, then LU Engine, in Settings, AI Backends. We are fixing the cause in the next update.
      </Hinweis>
    </div>
  )
}
