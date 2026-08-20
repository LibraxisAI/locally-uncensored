import { test, expect } from '@playwright/test'
import { bootApp, openModels, modelCalls, openedUrls } from './support/journeys/models'

/**
 * QA sweep, area `models` — Get new for image models: the bundle grid and the
 * CivitAI search box that sits under it. A bundle is not one file but a set
 * (checkpoint plus VAE plus both text encoders), so the install is only real
 * if EVERY part left for the right ComfyUI subfolder.
 *
 * Windows, because the ComfyUI-backed media lane only exists there; a Mac
 * shows the MLX panel on these rails instead.
 */

const FLUX = 'FLUX.1 [schnell] FP8 (Fast & Modern)'
const bundle = (page: import('@playwright/test').Page, name: string) =>
  page.locator(`[data-bundle-tile="${name}"]`)

async function openImageCatalog(page: import('@playwright/test').Page) {
  await openModels(page)
  await page.getByTestId('models.category-rail.select').filter({ hasText: 'Image' }).click()
  await page.getByTestId('models.tab-get-new.select').click()
  await expect(bundle(page, FLUX)).toBeVisible()
}

test('installing a bundle downloads every one of its files into its own folder', async ({ page }) => {
  await bootApp(page)
  await openImageCatalog(page)

  const flux = bundle(page, FLUX)
  await expect(flux).toContainText('4 files')

  // ── models.bundle-tile.install ───────────────────────────────────
  await flux.getByTestId('models.bundle-tile.install').click()

  // All four parts, each aimed at the ComfyUI folder its loader reads from.
  await expect
    .poll(async () => (await modelCalls(page))
      .filter((c) => c.cmd === 'download_model')
      .map((c) => `${(c as { subfolder?: string }).subfolder}/${(c as { filename?: string }).filename}`)
      .sort(), { timeout: 20_000 })
    .toEqual([
      'diffusion_models/flux1-schnell-fp8.safetensors',
      'text_encoders/clip_l.safetensors',
      'text_encoders/t5xxl_fp8_e4m3fn.safetensors',
      'vae/ae.safetensors',
    ])

  // And the tile follows the downloads through to done.
  await expect(flux).toContainText('Installed', { timeout: 20_000 })
})

test('the bundle tile opens its source page in the system browser', async ({ page }) => {
  await bootApp(page)
  await openImageCatalog(page)

  // ── models.view-on-huggingface.click-2 ───────────────────────────
  expect(await openedUrls(page)).toHaveLength(0)
  await bundle(page, FLUX).getByTestId('models.view-on-huggingface.click-2').click()
  await expect.poll(() => openedUrls(page)).toEqual(['https://huggingface.co/Comfy-Org/flux1-schnell'])
  // Reading the page must not install anything.
  expect((await modelCalls(page)).filter((c) => c.cmd === 'download_model')).toHaveLength(0)
})

test('the CivitAI search runs and says when a query found nothing', async ({ page }) => {
  await bootApp(page)
  await openImageCatalog(page)

  // ── models.civitai-search.submit ─────────────────────────────────
  // Empty query: the button is inert, so nothing can be searched by accident.
  await expect(page.getByTestId('models.civitai-search.submit')).toBeDisabled()

  await page.getByPlaceholder(/flux, sdxl realistic/).fill('nothing-matches-this-xyz')
  await expect(page.getByTestId('models.civitai-search.submit')).toBeEnabled()
  await page.getByTestId('models.civitai-search.submit').click()

  // The empty-result hint only renders once a search has actually been ISSUED
  // and come back — before the first submit the same card shows nothing at
  // all, which is the silent gap this state was added for.
  await expect(page.getByText(/No matches for "nothing-matches-this-xyz"/)).toBeVisible()
})
