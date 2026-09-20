/**
 * @vitest-environment jsdom
 *
 * box-gruen/n9 Punkt 87 (ENG-18): "Update ComfyUI" used to call
 * `runUpdate()` the instant it was clicked -- no confirmation, and no lock
 * against a ComfyUI already on the port, own or foreign. The real damage on
 * the Windows box: a foreign ComfyUI read as plain "Running", the click
 * started "Installing ComfyUI..." anyway, and a Cancel taken 1-2 seconds
 * later left a pulled core with an unfinished venv
 * (`ModuleNotFoundError: No module named 'comfy_aimdo.storage'`).
 *
 * This mounts the real panel and checks the house-pattern dialog (same shape
 * as `TrainerReinstallModal`): it appears on click, Escape and the X both
 * close it without calling the backend, and only the dialog's own Update
 * button calls `update_comfyui`. Separately, a ComfyUI this app did not
 * start blocks the click before the dialog even opens.
 *
 * Final review 19.09.2026 added two more cases: `ownedByApp` (not
 * `processAlive`, which lies about LU's own ComfyUI after an app restart,
 * B2) decides ownership, the dialog text says LU stops its own ComfyUI
 * first (B4), and a fast double click on the dialog's own Update button
 * fires the backend only once (K2).
 *
 * Run: npx vitest run src/components/settings/__tests__/comfy-update-confirm-dialog.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement } from 'react'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'

const backendCall = vi.fn()
vi.mock('../../../api/backend', () => ({
  backendCall: (...args: unknown[]) => backendCall(...args),
  isTauri: () => true,
  isMacOS: () => false,
  isWindows: () => true,
  openExternal: vi.fn(),
  secretGet: vi.fn().mockRejectedValue(new Error('no keychain here')),
  secretSet: vi.fn(),
  secretDelete: vi.fn(),
  setComfyPort: vi.fn(),
  setComfyHost: vi.fn(),
}))

const { ComfyUISettings } = await import('../SettingsPage')
const { useComfyInstallStore } = await import('../../../stores/comfyInstallStore')

/** What `comfyui_status` answers next. Own, idle ComfyUI by default. */
let comfyStatus: Record<string, unknown> = {
  running: false, found: true, complete: true, path: 'C:\\ComfyUI', isLocal: true, ownedByApp: false,
}

beforeEach(() => {
  useComfyInstallStore.getState().reset()
  comfyStatus = { running: false, found: true, complete: true, path: 'C:\\ComfyUI', isLocal: true, ownedByApp: false }
  backendCall.mockReset()
  backendCall.mockImplementation(async (cmd: string) => {
    if (cmd === 'comfyui_status') return comfyStatus
    if (cmd === 'update_comfyui') return { status: 'installing' }
    if (cmd === 'install_comfyui_status') return { status: 'installing', logs: ['Updating ComfyUI...'] }
    return {}
  })
})
afterEach(() => { cleanup(); useComfyInstallStore.getState().reset() })

async function mountPanel() {
  render(createElement(ComfyUISettings))
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

describe('the Update ComfyUI confirmation dialog', () => {
  it('does not call the backend on a bare click, only opens the dialog', async () => {
    await mountPanel()
    await act(async () => { fireEvent.click(screen.getByText('Update ComfyUI')) })

    expect(screen.getByRole('dialog', { name: /Update ComfyUI\?/ })).toBeTruthy()
    expect(backendCall.mock.calls.some(([cmd]) => cmd === 'update_comfyui')).toBe(false)
  })

  it('names the folder as read-only text and says LU stops its own ComfyUI first (B4)', async () => {
    await mountPanel()
    await act(async () => { fireEvent.click(screen.getByText('Update ComfyUI')) })

    // B4: the old wording ("ComfyUI must not be running") hid the fact that
    // LU itself kills a running, own ComfyUI as part of the update.
    expect(screen.getByText(/it will be stopped first/)).toBeTruthy()
    expect(screen.getByText(/C:\\ComfyUI/)).toBeTruthy()
    // Read-only: no textbox for the folder, unlike the Path field above it.
    expect(screen.queryByRole('textbox', { name: /ComfyUI folder/ })).toBeNull()
  })

  it('Escape closes the dialog without calling the backend', async () => {
    await mountPanel()
    await act(async () => { fireEvent.click(screen.getByText('Update ComfyUI')) })
    expect(screen.getByRole('dialog', { name: /Update ComfyUI\?/ })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Update ComfyUI\?/ })).toBeNull())
    expect(backendCall.mock.calls.some(([cmd]) => cmd === 'update_comfyui')).toBe(false)
  })

  it('the X closes the dialog without calling the backend', async () => {
    await mountPanel()
    await act(async () => { fireEvent.click(screen.getByText('Update ComfyUI')) })

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Update ComfyUI\?/ })).toBeNull())
    expect(backendCall.mock.calls.some(([cmd]) => cmd === 'update_comfyui')).toBe(false)
  })

  it('the Cancel button in the dialog closes it without calling the backend', async () => {
    await mountPanel()
    await act(async () => { fireEvent.click(screen.getByText('Update ComfyUI')) })

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Update ComfyUI\?/ })).toBeNull())
    expect(backendCall.mock.calls.some(([cmd]) => cmd === 'update_comfyui')).toBe(false)
  })

  it('only the dialog Update button calls update_comfyui, and only once confirmed', async () => {
    await mountPanel()
    await act(async () => { fireEvent.click(screen.getByText('Update ComfyUI')) })
    expect(backendCall.mock.calls.some(([cmd]) => cmd === 'update_comfyui')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() => expect(backendCall.mock.calls.some(([cmd]) => cmd === 'update_comfyui')).toBe(true))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Update ComfyUI\?/ })).toBeNull())
  })

  it('K2: two fast clicks on the dialog Update button call the backend only once', async () => {
    await mountPanel()
    await act(async () => { fireEvent.click(screen.getByText('Update ComfyUI')) })

    const updateButton = screen.getByRole('button', { name: 'Update' })
    // Both clicks fire before any state update is flushed, exactly the race
    // the ref guard in `handleConfirmUpdate` exists to close.
    fireEvent.click(updateButton)
    fireEvent.click(updateButton)

    await waitFor(() => expect(backendCall.mock.calls.some(([cmd]) => cmd === 'update_comfyui')).toBe(true))
    expect(backendCall.mock.calls.filter(([cmd]) => cmd === 'update_comfyui').length).toBe(1)
  })
})

describe('a ComfyUI this app did not start blocks the click, negative control included', () => {
  it('a foreign, running ComfyUI shows a message instead of opening the dialog', async () => {
    comfyStatus = { running: true, found: true, complete: true, path: 'C:\\ComfyUI', isLocal: true, ownedByApp: false }
    await mountPanel()

    await act(async () => { fireEvent.click(screen.getByText('Update ComfyUI')) })

    expect(screen.queryByRole('dialog', { name: /Update ComfyUI\?/ })).toBeNull()
    expect(screen.getByText(/did not start is using this folder/)).toBeTruthy()
    expect(backendCall.mock.calls.some(([cmd]) => cmd === 'update_comfyui')).toBe(false)
    // The status line itself says so too (ownedByApp: false while running).
    expect(screen.getByText('Running (started outside LU)')).toBeTruthy()
  })

  it('GEGENPROBE: the app\'s own running ComfyUI opens the dialog like any other case', async () => {
    // Negative control for the guard above: same `running: true`, but this
    // time the backend says it is ours.
    comfyStatus = { running: true, found: true, complete: true, path: 'C:\\ComfyUI', isLocal: true, ownedByApp: true }
    await mountPanel()

    await act(async () => { fireEvent.click(screen.getByText('Update ComfyUI')) })

    expect(screen.getByRole('dialog', { name: /Update ComfyUI\?/ })).toBeTruthy()
    expect(screen.queryByText(/did not start is using this folder/)).toBeNull()
    expect(screen.getByText('Running')).toBeTruthy()
    // Final review 19.09.2026, B2: `ownedByApp: true` is exactly the answer
    // the backend now gives for BOTH a live handle from this run AND an
    // orphan adopted from an earlier one (`find_orphaned_comfyui`) -- the
    // frontend cannot and must not tell those two apart on its own, it only
    // reads the one shared verdict. The Rust-side distinction itself is
    // proven in `process.rs`'s `comfy_adoption_tests` (`classify_comfyui_ownership`).
    expect(screen.queryByText('Running (started outside LU)')).toBeNull()
  })
})
