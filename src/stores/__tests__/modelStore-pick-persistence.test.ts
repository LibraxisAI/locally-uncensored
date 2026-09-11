/**
 * Befund 3 of the abnahme counter-check (2026-08-29), store side.
 *
 * The second half of what lost the pick across a restart: setModels
 * auto-selects the first chat model whenever the active one is not in the
 * incoming list. That is right for a model the user deleted and wrong for an
 * empty list, and fetchModels writes its result here even when every provider
 * failed.
 *
 * Run: npx vitest run src/stores/__tests__/modelStore-pick-persistence.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }))
vi.mock('../../api/backend', () => ({
  isTauri: vi.fn(() => false),
  backendCall: vi.fn(async () => undefined),
}))
vi.mock('../../api/ollama', () => ({ unloadModel: vi.fn(async () => undefined) }))
vi.mock('../../api/lmstudio', () => ({ unloadLmStudioModel: vi.fn(async () => undefined) }))
vi.mock('../../api/engine', () => ({ activateBuiltinModel: vi.fn(async () => undefined) }))

import { useModelStore } from '../modelStore'

const here = dirname(fileURLToPath(import.meta.url))
const storeSrc = readFileSync(resolve(here, '../modelStore.ts'), 'utf8')
const shellSrc = readFileSync(resolve(here, '../../components/layout/AppShell.tsx'), 'utf8')

const QWEN = 'openai::Qwen3-4B-Q4_K_M'
const HERMES = 'openai::Hermes-3-Llama-3.2-3B.Q4_K_M'

const chat = (name: string) => ({
  name, model: name, size: 0, type: 'text' as const,
  provider: 'openai' as const, providerName: 'Built-in Engine',
})

beforeEach(() => {
  useModelStore.setState({ models: [], activeModel: QWEN })
})

describe('an empty model list is not a reason to drop the pick', () => {
  it('THE FIX: setModels([]) leaves the rehydrated pick alone', () => {
    useModelStore.getState().setModels([])
    expect(useModelStore.getState().activeModel).toBe(QWEN)
  })

  it('the real list arrives and the pick is confirmed, not replaced', () => {
    useModelStore.getState().setModels([chat(HERMES), chat(QWEN)])
    expect(useModelStore.getState().activeModel).toBe(QWEN)
  })

  it('clears a deleted pick when only small replacements remain', () => {
    // The dead-name guard has to keep working, or the picker shows a model
    // the provider no longer has and clicking it opens an empty list.
    useModelStore.setState({ activeModel: 'openai::deleted-model' })
    useModelStore.getState().setModels([chat(HERMES), chat(QWEN)])
    expect(useModelStore.getState().activeModel).toBeNull()
  })

  it('NEGATIVE CONTROL: an empty list does not invent a pick out of nothing', () => {
    useModelStore.setState({ activeModel: null })
    useModelStore.getState().setModels([])
    expect(useModelStore.getState().activeModel).toBeNull()
  })

  it('NEGATIVE CONTROL: a list of nothing but ComfyUI files selects no chat model', () => {
    useModelStore.setState({ activeModel: null })
    useModelStore.getState().setModels([
      { name: 'sd_turbo.safetensors', model: 'sd_turbo.safetensors', size: 0, type: 'image', format: 'safetensors', architecture: 'sdxl', providerName: 'ComfyUI' },
    ])
    expect(useModelStore.getState().activeModel).toBeNull()
  })
})

describe('the pick is written to disk in the first place', () => {
  it('automatically chooses the first verified 7B model, not a small or opaque row', () => {
    useModelStore.setState({ activeModel: null })
    useModelStore.getState().setModels([chat(HERMES), chat('opaque'), chat('test-7B')])
    expect(useModelStore.getState().activeModel).toBe('test-7B')
  })
  it('activeModel is part of what persist keeps', () => {
    expect(storeSrc).toMatch(/partialize:[\s\S]*?activeModel: state\.activeModel/)
  })

  it('die Wahl je Modus liegt mit im Speicher', () => {
    // Fund 1 der Kampagne 3.0.0: wer die App in der Cloud schliesst und am
    // naechsten Tag lokal weiterarbeitet, bekommt sonst denselben leeren
    // Waehler wie nach dem blossen Umschalten.
    expect(storeSrc).toMatch(/partialize:[\s\S]*?lastLocalModel: state\.lastLocalModel/)
    expect(storeSrc).toMatch(/partialize:[\s\S]*?lastCloudModel: state\.lastCloudModel/)
  })

  it('the mode reselect no longer decides anything by hand', () => {
    // It asks pickForMode, which holds the empty list harmless. The old
    // inline version is what cleared the pick on mount.
    // The fourth argument is the model the user named on the way into cloud
    // mode by clicking its row in the picker (Nebenbefund 1, R10 re-measure),
    // das fuenfte die Wahl, die jeder Modus zuletzt hatte (Fund 1, T3 und T1
    // auf der Box). The call is still the rule, not a hand-rolled decision.
    expect(shellSrc).toMatch(
      /pickForMode\(activeModel, allModels, appMode, pendingCloudModel, \{\s*\n\s*local: lastLocalModel,\s*\n\s*cloud: lastCloudModel,\s*\n\s*\}\)/,
    )
    expect(shellSrc).not.toMatch(/const inMode = \(name: string \| null\)/)
  })
})
