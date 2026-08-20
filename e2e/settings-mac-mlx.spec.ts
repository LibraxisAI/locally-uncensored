import { test, expect } from '@playwright/test'
import { openSettings, gotoTab, openSection, lastCall, invokeCount } from './support/journeys/settings'

/**
 * QA sweep, area `settings`: Local Media (Apple MLX) on the AI Backends tab.
 *
 * On a Mac this panel replaces the whole ComfyUI surface, so it is the only
 * route a fresh Mac has to local image and video at all. Every install here
 * has to be watched to completion and every delete has to actually free the
 * disk, which is why each assertion ends at the MLX command, not the spinner.
 */

const MAC = { platform: 'mac' as const }

/** The innermost row that carries both a model's name and its own buttons. */
const modelRow = (page: import('@playwright/test').Page, name: string) =>
  page
    .locator('div')
    .filter({ has: page.getByText(name, { exact: true }) })
    .filter({ has: page.getByTestId(/^settings\.mlx-model\./) })
    .last()

async function openMlx(page: import('@playwright/test').Page, opts: Record<string, unknown> = {}) {
  await openSettings(page, { ...MAC, ...opts })
  await gotoTab(page, 'AI Backends')
  await openSection(page, 'Local Media (Apple MLX)', 'settings.huggingface-token.click')
}

test('mlx: the HuggingFace token reaches Rust and is never echoed back', async ({ page }) => {
  await openMlx(page)

  // Without a token every hub download is anonymous and throttled (#160), so
  // saving has to arm Rust immediately, because the keychain alone is not enough.
  await page.getByLabel('HuggingFace token').fill('hf_settings_probe')
  await page.getByTestId('settings.huggingface-token.click').click()
  await expect(page.getByTestId('settings.huggingface-token.click')).toHaveText(/Saved/)

  await expect
    .poll(() => page.evaluate(() => (window as any).__E2E_HF_TOKEN__))
    .toBe('hf_settings_probe')
  // The recorded call may say a token is present, never what it is.
  const call = await lastCall(page, '__E2E_MLX_CALLS__', 'set_hf_token')
  expect(call).toMatchObject({ present: true })
  expect(JSON.stringify(call)).not.toContain('hf_settings_probe')
})

test('mlx: a fresh Mac installs both engines, and the model buttons wait for them', async ({ page }) => {
  await openMlx(page, { mlx: { engineInstalled: false, videoEngineInstalled: false, installedImages: [], installedVideos: [] } })

  // Nothing is installed, and the panel is explicit about the cost rather
  // than hiding a 3 GB download behind a bare button.
  await expect(page.getByText(/about 3 GB of Python packages/)).toBeVisible()
  // A model cannot be installed before its engine exists, and the button says so
  // instead of failing halfway through a multi-GB download.
  const modelButtons = page.getByTestId('settings.mlx-model.install')
  await expect(modelButtons.first()).toBeDisabled()

  // ── Image engine ─────────────────────────────────────────────
  await page.getByTestId('settings.mlx-image-engine.install').click()
  await expect.poll(() => invokeCount(page, 'install_mlx_diffusion')).toBeGreaterThan(0)
  // The button is gone because mlx_status now reports the engine present, so
  // the panel re-reads the backend rather than trusting its own click.
  await expect(page.getByTestId('settings.mlx-image-engine.install')).toHaveCount(0, { timeout: 30_000 })

  // ── Video engine ─────────────────────────────────────────────
  await page.getByTestId('settings.mlx-video-engine.install').click()
  await expect.poll(() => invokeCount(page, 'video_install_mlx')).toBeGreaterThan(0)
  await expect(page.getByTestId('settings.mlx-video-engine.install')).toHaveCount(0, { timeout: 30_000 })

  // With both engines in, the model installs unlock.
  await expect(modelButtons.first()).toBeEnabled()
})

test('mlx: installing a model asks for that exact model, and the row flips to installed', async ({ page }) => {
  await openMlx(page, { mlx: { installedImages: [], installedVideos: [] } })

  // ── Image model ──────────────────────────────────────────────
  // "Realistic Vision V5.1" is the second image row; installing it must not
  // silently pull the first one in the catalogue.
  const row = modelRow(page, 'Realistic Vision V5.1')
  await row.getByTestId('settings.mlx-model.install').click()
  await expect
    .poll(async () => (await lastCall(page, '__E2E_MLX_CALLS__', 'mlx_image_install_model'))?.id, { timeout: 30_000 })
    .toBe('realistic-vision-v51')
  await expect(row.getByTestId('settings.mlx-model.remove')).toBeVisible({ timeout: 30_000 })

  // ── Video model ──────────────────────────────────────────────
  const videoRow = modelRow(page, 'Wan 2.1 T2V 1.3B')
  await videoRow.getByTestId('settings.mlx-model.install').click()
  await expect
    .poll(async () => (await lastCall(page, '__E2E_MLX_CALLS__', 'video_install_model'))?.id, { timeout: 60_000 })
    .toBe('wan21-t2v-1.3b')
})

test('mlx: removing a model is a two-step, and Cancel keeps the download', async ({ page }) => {
  await openMlx(page, { mlx: { installedImages: ['sd-turbo'], installedVideos: [] } })

  const row = modelRow(page, 'SD Turbo')

  // ── Cancel ───────────────────────────────────────────────────
  // A stray click must not throw away a multi-GB download.
  await row.getByTestId('settings.mlx-model.remove').click()
  await expect(row.getByTestId('settings.mlx-model.delete-confirm')).toBeVisible()
  await row.getByTestId('settings.mlx-model.delete-cancel').click()
  await expect(row.getByTestId('settings.mlx-model.remove')).toBeVisible()
  expect(await invokeCount(page, 'mlx_image_delete_model')).toBe(0)

  // ── Confirm ──────────────────────────────────────────────────
  await row.getByTestId('settings.mlx-model.remove').click()
  await row.getByTestId('settings.mlx-model.delete-confirm').click()
  await expect
    .poll(async () => (await lastCall(page, '__E2E_MLX_CALLS__', 'mlx_image_delete_model'))?.id)
    .toBe('sd-turbo')
  // The list is re-read from the backend, so the row goes back to offering
  // Install rather than just hiding the Remove button.
  await expect(row.getByTestId('settings.mlx-model.install')).toBeVisible()
})
