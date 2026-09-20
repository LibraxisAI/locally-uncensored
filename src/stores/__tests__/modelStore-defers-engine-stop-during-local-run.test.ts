import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * B6 (lu-301/bau/klaerung-n7.md), zweiter unbewachter Weg: `setActiveModel`
 * rief `stop_bundled_engine` bisher UNBEDINGT, sobald das vorige Modell der
 * eingebaute Motor war und das neue keiner ist. `AppShell.tsx` ruft genau
 * diesen Wechsel bei JEDEM Cloud-Umschalten automatisch auf
 * (`setActiveModel(pick.next)`), auch waehrend eine ANDERE Unterhaltung noch
 * lokal generiert. Der schon bestehende Schutz `offloadWhenLocalLaneFree`
 * (`lib/cloud-offload-defer.ts`) bewachte bis jetzt nur AppShells eigenen
 * `offload_local_models`-Aufruf, nicht diesen hier.
 *
 * Dieser Test faehrt den ECHTEN `modelStore` gegen den ECHTEN
 * `generationStore`, nur `backendCall` ist gemockt (kein Tauri-Invoke).
 *
 * Lauf: npx vitest run src/stores/__tests__/modelStore-defers-engine-stop-during-local-run.test.ts
 */

const backendCall = vi.fn(async (..._args: unknown[]) => ({}))
const unloadModel = vi.fn(async (..._args: unknown[]) => undefined)
const unloadLmStudioModel = vi.fn(async (..._args: unknown[]) => undefined)

vi.mock('../../api/backend', () => ({
  backendCall: (...a: unknown[]) => backendCall(...a),
  isTauri: () => true,
}))
vi.mock('../../api/ollama', () => ({
  unloadModel: (...a: unknown[]) => unloadModel(...a),
}))
vi.mock('../../api/lmstudio', () => ({
  unloadLmStudioModel: (...a: unknown[]) => unloadLmStudioModel(...a),
}))
vi.mock('../../lib/hf-to-provider', () => ({
  isLmStudioProvider: (n?: string) => (n || '').includes('LM Studio'),
}))

import { useModelStore } from '../modelStore'
import { useGenerationStore } from '../generationStore'
import type { AIModel } from '../../types/models'

const builtin = (name: string): AIModel =>
  ({ name: `openai::${name}`, model: name, size: 1, type: 'text', provider: 'openai', providerName: 'LU Engine' } as unknown as AIModel)
const cloudModel = (name: string): AIModel =>
  ({ name, model: name, size: 1, type: 'text', provider: 'anthropic', providerName: 'Anthropic' } as unknown as AIModel)

const CONV_ID = 'conv-with-a-running-local-turn'
const RUN_TOKEN = {}

describe('modelStore.setActiveModel defers stop_bundled_engine while a local run is booked', () => {
  beforeEach(() => {
    backendCall.mockClear()
    useModelStore.setState({
      models: [builtin('qwenA'), cloudModel('claude-x')],
      activeModel: 'openai::qwenA',
    })
    useGenerationStore.setState({ runs: {}, generating: {}, aborters: {} })
  })

  it('does NOT stop the engine while a local run is booked, and fires exactly once after it ends', () => {
    useGenerationStore.getState().bookRun(CONV_ID, 'local', RUN_TOKEN)

    // The mode-switch reselect AppShell.tsx does on entering Cloud.
    useModelStore.getState().setActiveModel('claude-x')

    expect(backendCall).not.toHaveBeenCalledWith('stop_bundled_engine')

    useGenerationStore.getState().endRun(CONV_ID, RUN_TOKEN)

    expect(backendCall).toHaveBeenCalledWith('stop_bundled_engine')
    expect(backendCall.mock.calls.filter((c) => c[0] === 'stop_bundled_engine')).toHaveLength(1)
  })

  it('Gegenprobe: without an active local run, the stop fires immediately (unchanged behaviour)', () => {
    useModelStore.getState().setActiveModel('claude-x')
    expect(backendCall).toHaveBeenCalledWith('stop_bundled_engine')
  })

  it('Gegenprobe: switching back to Local (a built-in model) before the run ends means NO stop ever fires', () => {
    useGenerationStore.getState().bookRun(CONV_ID, 'local', RUN_TOKEN)

    useModelStore.getState().setActiveModel('claude-x') // defers
    useModelStore.getState().setActiveModel('openai::qwenA') // user flips back to Local

    backendCall.mockClear()
    useGenerationStore.getState().endRun(CONV_ID, RUN_TOKEN)

    expect(backendCall).not.toHaveBeenCalledWith('stop_bundled_engine')
  })
})
