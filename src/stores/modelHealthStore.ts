import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Tracks which installed Ollama models have stale manifests (rejected by
 * Ollama 0.20.7 with "does not support (chat|completion|generate)").
 *
 * Populated by the startup health scan (AppShell) and consumed by:
 *   - StaleModelsBanner — top-of-app notice with "Refresh All"
 *   - Header Lichtschalter — knows without a load attempt that the model is stale
 *   - DiscoverModels — shows "Needs Refresh" badge instead of green "Installed"
 *
 * `dismissed` is session-only so the banner reappears next launch if stale
 * models remain. `lastScanTime` is persisted so we can skip re-scan for a
 * cool-down window on app restart.
 */

interface ModelHealthState {
  staleModels: string[]
  lastScanTime: number
  scanning: boolean
  dismissed: boolean
  // actions
  setStaleModels: (models: string[]) => void
  markFresh: (name: string) => void
  setScanning: (scanning: boolean) => void
  dismiss: () => void
  reset: () => void
}

export const useModelHealthStore = create<ModelHealthState>()(
  persist(
    (set) => ({
      staleModels: [],
      lastScanTime: 0,
      scanning: false,
      dismissed: false,
      // Only un-dismiss when the stale set actually CHANGED. The health scan
      // runs once per launch, so clearing the flag unconditionally meant the
      // banner returned on every start over the same untouched model and
      // "dismiss" was decorative.
      setStaleModels: (models) =>
        set((s) => {
          const same =
            s.staleModels.length === models.length &&
            models.every((m) => s.staleModels.includes(m))
          return {
            staleModels: models,
            lastScanTime: Date.now(),
            dismissed: same ? s.dismissed : false,
          }
        }),
      markFresh: (name) =>
        set((s) => ({ staleModels: s.staleModels.filter((m) => m !== name) })),
      setScanning: (scanning) => set({ scanning }),
      dismiss: () => set({ dismissed: true }),
      reset: () =>
        set({ staleModels: [], scanning: false, dismissed: false, lastScanTime: 0 }),
    }),
    {
      name: 'locally-uncensored-model-health',
      // `dismissed` is session-only, because that is exactly what both buttons
      // that set it promise: "Dismiss until next launch". Persisting it (2.5.9)
      // made the banner disappear for good over an unchanged stale model, so
      // the label and the behaviour said different things and a broken model
      // could sit on disk unmentioned forever. Within one session the flag
      // still holds — the startup scan runs once and only clears it when the
      // stale set actually changed (setStaleModels), so a dismissal is not
      // undone a second later. `scanning` stays session-only too: a crash
      // mid-scan must not persist as "still scanning".
      partialize: (s) => ({ staleModels: s.staleModels, lastScanTime: s.lastScanTime }),
    }
  )
)
