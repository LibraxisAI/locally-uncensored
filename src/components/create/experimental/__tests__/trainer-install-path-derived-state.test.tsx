// @vitest-environment jsdom
/**
 * Lint-Fix (react-hooks/set-state-in-effect, 19.09.2026,
 * bau/lintfix.md): `LocalTrainControls` used to keep a second state variable
 * (`installPath`) in sync with `status`/`pathTouched` through a `useEffect`
 * that called `setInstallPath(...)`. That is state derived from other state,
 * which belongs in render, not in an effect. The fix replaces the effect
 * with a plain expression computed on every render:
 *
 *   installPath = pathTouched
 *     ? typedPath
 *     : status?.customized ? status.root : (status?.suggestedRoot ?? '')
 *
 * This file pins the truth table for the value that actually reaches
 * `installCharacterTrainer` (via `installPath.trim() || undefined`),
 * specifically through the "Reinstall trainer" dialog, which renders only
 * once `envReady` is already true -- exactly the branch where the old
 * `TrainerPathField` (covered by k5-trainer-path-honesty.test.tsx) is never
 * shown, so the derived value was previously invisible except through this
 * one code path. `k5-trainer-path-honesty.test.tsx` already covers the
 * pre-install-gate half of the same table (customized/suggestedRoot/typed/
 * cleared, all with `pathTouched` reaching `false`/`true` through the
 * visible field); this file covers the two cases that only show up once
 * `envReady` is true and the field itself is gone.
 *
 * Run: npx vitest run src/components/create/experimental/__tests__/trainer-install-path-derived-state.test.tsx
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../../../api/backend', () => ({
  isTauri: () => true,
  isMacOS: () => false,
  isWindows: () => true,
  isLinux: () => false,
  backendCall: vi.fn(async () => ({ status: 'ok' })),
}))

const installCharacterTrainer = vi.fn(async () => ({ status: 'installing' }))
let mockedStatus: Record<string, unknown> = {}
vi.mock('../../../../api/trainer', async () => {
  const actual = await vi.importActual<typeof import('../../../../api/trainer')>('../../../../api/trainer')
  return {
    ...actual,
    characterTrainerStatus: vi.fn(async () => mockedStatus),
    installCharacterTrainer: (...a: unknown[]) => installCharacterTrainer(...(a as [])),
  }
})
vi.mock('../../../../api/comfyui', () => ({ getLoraModels: vi.fn(async () => []) }))
vi.mock('../../../../api/cloud/loras', () => ({ listLoras: vi.fn(async () => []), deleteLora: vi.fn() }))
vi.mock('../../../../api/discover', async () => {
  const actual = await vi.importActual<typeof import('../../../../api/discover')>('../../../../api/discover')
  return {
    ...actual,
    startModelDownload: vi.fn(async () => {}),
    getDownloadProgress: vi.fn(async () => ({})),
  }
})

import { SpecialControls } from '../SpecialIntentControls'
import { useCreateStore } from '../../../../stores/createStore'

function readyStatus(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    envReady: true,
    basesReady: true,
    dit: 'x',
    textEncoder: 'x',
    vae: 'x',
    root: '/data/lu/musubi',
    customized: false,
    suggestedRoot: null,
    install: { status: 'idle', logs: [] },
    ...overrides,
  }
}

beforeEach(() => {
  cleanup()
  installCharacterTrainer.mockClear()
  useCreateStore.setState({ backend: 'local', characterTab: 'train' })
})

async function openAndConfirmReinstall() {
  render(<SpecialControls intent="character" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Reinstall trainer' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Reinstall' }))
}

describe('Lint-Fix Wahrheitstabelle: abgeleiteter installPath ueber den Reinstall-Dialog', () => {
  it('customized: false, kein suggestedRoot -- kein Pfad geht raus (Blocker-Fall)', async () => {
    mockedStatus = readyStatus({ customized: false, suggestedRoot: null, root: 'C:\\test-trainer' })
    await openAndConfirmReinstall()
    expect(installCharacterTrainer).toHaveBeenCalledWith(undefined)
  })

  it('customized: true -- der eigene Ordner bleibt erhalten', async () => {
    mockedStatus = readyStatus({ customized: true, suggestedRoot: null, root: 'D:\\CustomTrainer' })
    await openAndConfirmReinstall()
    expect(installCharacterTrainer).toHaveBeenCalledWith('D:\\CustomTrainer')
  })

  it('customized: false, suggestedRoot gesetzt -- der Vorschlag zaehlt, nicht der aktuelle root', async () => {
    // Deckt exakt den Fall ab, den e2e/trainer-reinstall-confirm.spec.ts fuer
    // die abgelehnte Installation braucht: ohne editierbares Feld ist dies
    // der einzige Weg, wie ein vom Nutzer nicht getippter Pfad ueberhaupt bei
    // install_character_trainer ankommt.
    mockedStatus = readyStatus({ customized: false, suggestedRoot: '/mnt/e/LU-Trainer', root: 'C:\\test-trainer' })
    await openAndConfirmReinstall()
    expect(installCharacterTrainer).toHaveBeenCalledWith('/mnt/e/LU-Trainer')
  })

  it('GEGENPROBE: customized true UND suggestedRoot gesetzt -- der eigene Ordner gewinnt, nicht der Vorschlag', async () => {
    mockedStatus = readyStatus({ customized: true, suggestedRoot: '/mnt/e/LU-Trainer', root: 'D:\\CustomTrainer' })
    await openAndConfirmReinstall()
    expect(installCharacterTrainer).toHaveBeenCalledWith('D:\\CustomTrainer')
  })
})
