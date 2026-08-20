import { test, expect } from '@playwright/test'
import { openSettings, openSection, readSettings, lastCall, readStore, invokeCount } from './support/journeys/settings'

/**
 * QA sweep, area `settings`: the hardware page and the diagnostics a support
 * ticket starts with.
 *
 * The GPU picker is the one settings surface whose whole point is that the
 * choice leaves the app: it has to arrive in Rust as `set_gpu_selection`
 * before the next Ollama / ComfyUI spawn reads it. So every assertion here
 * ends at the recorded backend call, not at the checkbox.
 */

const TWO_CARDS = [
  { index: 0, vendor: 'nvidia', name: 'NVIDIA GeForce RTX 4090', memory_mib: 24576, source: 'nvidia-smi', note: null },
  { index: 1, vendor: 'amd', name: 'AMD Radeon RX 7900 XTX', memory_mib: 24576, source: 'rocm-smi', note: null },
]

test('hardware: picking a vendor and a card forwards the selection to Rust', async ({ page }) => {
  await openSettings(page, { sys: { gpus: TWO_CARDS } })
  await openSection(page, 'Hardware (GPU picker)')

  // Both detected cards are listed with the source that found them.
  await expect(page.getByText('NVIDIA GeForce RTX 4090')).toBeVisible()
  await expect(page.getByText('AMD Radeon RX 7900 XTX')).toBeVisible()

  // ── Vendor pick ──────────────────────────────────────────────
  // Choosing NVIDIA narrows the card list AND pushes the selection down;
  // the indices reset with the vendor, which is what Rust must be told.
  await page.getByRole('radio', { name: /NVIDIA \(CUDA_VISIBLE_DEVICES\)/ }).check()
  expect((await readSettings(page)).gpuVendor).toBe('nvidia')
  await expect(page.getByText('AMD Radeon RX 7900 XTX')).toHaveCount(0)
  await expect
    .poll(async () => (await lastCall(page, '__E2E_SYS_CALLS__', 'set_gpu_selection'))?.selection)
    .toEqual({ vendor: 'nvidia', indices: [] })

  // ── Card pick ────────────────────────────────────────────────
  await page.getByRole('checkbox').first().check()
  expect((await readSettings(page)).gpuIndices).toEqual([0])
  await expect
    .poll(async () => (await lastCall(page, '__E2E_SYS_CALLS__', 'set_gpu_selection'))?.selection)
    .toEqual({ vendor: 'nvidia', indices: [0] })
  // The honest consequence is spelled out, not left for the user to discover.
  await expect(page.getByText(/takes effect on next Ollama \/ ComfyUI spawn/i)).toBeVisible()

  // ── ComfyUI GPU mode ─────────────────────────────────────────
  // Its own Rust command, separate from the vendor selection.
  await page.getByRole('radio', { name: /Force CPU/ }).check()
  expect((await readSettings(page)).comfyGpuMode).toBe('cpu')
  await expect.poll(async () => (await lastCall(page, '__E2E_SYS_CALLS__', 'set_comfy_gpu_mode'))?.mode).toBe('cpu')
})

test('hardware: Re-detect re-reads the card list from Rust', async ({ page }) => {
  // A box that reports nothing at boot: the empty-state copy is what the user
  // sees, and Re-detect must genuinely ask again rather than repaint.
  await openSettings(page, { sys: { gpus: [] } })
  await openSection(page, 'Hardware (GPU picker)')
  await expect(page.getByText(/No GPUs detected via nvidia-smi/)).toBeVisible()

  const before = await invokeCount(page, 'detect_gpus')
  await page.getByTestId('settings.re-detect-gpus.click').click()
  // Proof the click reached the backend: one more detect_gpus round trip than
  // the mount-time one, and the list is rebuilt from its answer.
  await expect.poll(() => invokeCount(page, 'detect_gpus')).toBeGreaterThan(before)
  await expect(page.getByText(/No GPUs detected via nvidia-smi/)).toBeVisible()
})

test('diagnostics: the health probe reports the host, and Re-probe asks again', async ({ page }) => {
  // 16 GiB box, so the RAM row carries a value the spec can pin instead of
  // whatever the machine running the suite happens to have.
  await openSettings(page, { sys: { totalMemoryBytes: 16 * 1024 * 1024 * 1024 } })
  await openSection(page, 'Troubleshoot')

  // The panel probes on open, so it never starts empty.
  await expect(page.getByText('16 GB')).toBeVisible()
  await expect(page.getByText('v0.0.0-e2e')).toBeVisible()
  // A fresh box has nothing running, and the badges say exactly that.
  await expect(page.getByTitle('connection refused (e2e)')).toHaveCount(3)

  const before = await invokeCount(page, 'system_health')
  await page.getByTestId('settings.health-probe.run').click()
  await expect.poll(() => invokeCount(page, 'system_health')).toBeGreaterThan(before)
  await expect(page.getByText('16 GB')).toBeVisible()
})

test('updates: a manual check reaches the updater and stamps the store', async ({ page }) => {
  await openSettings(page)
  await openSection(page, 'Updates')

  const check = page.getByTestId('settings.update.check')
  await expect(check).toHaveText('Check for updates')
  await check.click()

  // The check is real: it stamps `lastChecked` into the persisted update
  // store, which is the value the 6 h cooldown reads on the next launch.
  await expect
    .poll(async () => (await readStore(page, 'lu-update-checker-v2'))?.state?.lastChecked ?? 0, { timeout: 20_000 })
    .toBeGreaterThan(0)
  await expect(check).toHaveText('Check for updates')
})
