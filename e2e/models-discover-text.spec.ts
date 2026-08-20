import { test, expect } from '@playwright/test'
import { bootApp, openModels, settleCatalog, dlCalls, engineCalls, openedUrls } from './support/journeys/models'

/**
 * QA sweep, area `models` — Get new for chat models: the two catalog tabs,
 * the size chips, a family's variant menu, the details sheet with its repo
 * link, and the two ends of the Get button (a real download, and the refusal
 * when the picked model needs a backend that is switched off).
 *
 * World: the built-in engine is the active chat backend (the shipped default)
 * with no Ollama models on disk. That matters twice over: the download must
 * land FLAT in the app-owned models dir (not nested like LM Studio) and boot
 * the engine on it, and a catalog row that only exists as an Ollama tag must
 * refuse instead of pulling into a backend the chat picker is not pointed at.
 */

const WORLD = {}

/** One catalog tile, addressed by the family title it renders. */
const tile = (page: import('@playwright/test').Page, group: string) =>
  page.locator(`[data-model-tile="${group}"]`)

test('the catalog tabs and the size chips each rebuild the grid', async ({ page }) => {
  await bootApp(page, WORLD)
  await openModels(page)
  await settleCatalog(page)

  // Mainstream is the default landing tab.
  await expect(tile(page, 'IBM Granite 4.0 Micro')).toBeVisible()
  await expect(tile(page, 'Qwen3 4B Abliterated')).toHaveCount(0)

  // ── models.no-filters-no-limits.click ────────────────────────────
  await page.getByTestId('models.no-filters-no-limits.click').click()
  await expect(tile(page, 'Qwen3 4B Abliterated')).toBeVisible()
  await expect(tile(page, 'IBM Granite 4.0 Micro')).toHaveCount(0)

  // ── models.popular-models-with-tool-calling-vision.click ─────────
  await page.getByTestId('models.popular-models-with-tool-calling-vision.click').click()
  await expect(tile(page, 'IBM Granite 4.0 Micro')).toBeVisible()
  await expect(tile(page, 'Qwen3 4B Abliterated')).toHaveCount(0)

  // ── models.size-filter-chip.select ───────────────────────────────
  // Tiny is "4 GB and under": the 17 GB family has to leave the grid and the
  // 2 GB one has to stay.
  await expect(tile(page, 'Gemma 4 31B')).toBeVisible()
  await page.getByTestId('models.size-filter-chip.select').filter({ hasText: /^Tiny/ }).click()
  await expect(tile(page, 'Gemma 4 31B')).toHaveCount(0)
  await expect(tile(page, 'IBM Granite 4.0 Micro')).toBeVisible()

  await page.getByTestId('models.size-filter-chip.select').filter({ hasText: /^All$/ }).click()
  await expect(tile(page, 'Gemma 4 31B')).toBeVisible()
})

test('the variant menu re-points the tile at the quant the user picked', async ({ page }) => {
  await bootApp(page, WORLD)
  await openModels(page)
  await settleCatalog(page)

  const gemma = tile(page, 'Gemma 4 12B')
  const trigger = gemma.getByTestId('models.choose-a-size-quality.click')
  // Default pick for a 12 GB card: the biggest quant that still fits.
  await expect(trigger).toContainText('Q6_K · 10 GB')

  // ── models.choose-a-size-quality.click ───────────────────────────
  await trigger.click()
  const entries = gemma.getByTestId('models.variant-picker-entry.select')
  await expect(entries).toHaveCount(3)
  // A second click on the trigger closes it again.
  await trigger.click()
  await expect(entries).toHaveCount(0)

  // ── models.variant-picker-entry.select ───────────────────────────
  await trigger.click()
  await entries.filter({ hasText: 'Q8_0' }).click()
  await expect(entries).toHaveCount(0)
  await expect(trigger).toContainText('Q8_0 · 13 GB')
  // The download target moved with it: 13 GB is over this 12 GB card, so the
  // tile's fit hint has to switch from "runs on your PC" to the honest one.
  await expect(gemma).toContainText('Tight fit')
})

test('the details sheet carries the full catalog text and opens the repo', async ({ page }) => {
  await bootApp(page, WORLD)
  await openModels(page)
  await settleCatalog(page)

  // ── models.details.click-2 ───────────────────────────────────────
  await tile(page, 'IBM Granite 4.0 Micro').getByTestId('models.details.click-2').click()
  const sheet = page.getByRole('heading', { level: 2, name: 'IBM Granite 4.0 Micro', exact: true })
  await expect(sheet).toBeVisible()
  await expect(page.getByText('Q4_K_M', { exact: true })).toBeVisible()

  // ── models.model-details-repo-link.open ──────────────────────────
  expect(await openedUrls(page)).toHaveLength(0)
  await page.getByTestId('models.model-details-repo-link.open').click()
  await expect
    .poll(() => openedUrls(page))
    .toEqual(['https://huggingface.co/ibm-granite/granite-4.0-micro-GGUF'])

  await page.getByTestId('ui.close.click-2').click()
  await expect(sheet).toHaveCount(0)
})

test('a model that cannot be loaded in-app only offers its HuggingFace page', async ({ page }) => {
  await bootApp(page, WORLD)
  await openModels(page)
  await settleCatalog(page)

  // ── models.view-on-huggingface.click ─────────────────────────────
  // 236 GB, catalogued with canPull:false — there is no Get button at all.
  const glm = tile(page, 'GLM 5.1 754B MoE')
  await expect(glm.getByTestId('models.model-tile.download')).toHaveCount(0)
  await glm.getByTestId('models.view-on-huggingface.click').click()
  await expect.poll(() => openedUrls(page)).toEqual(['https://huggingface.co/unsloth/GLM-5.1-GGUF'])
  // Opening the page must not have started anything.
  expect(await dlCalls(page)).toHaveLength(0)
})

test('Get downloads the GGUF into the built-in engine dir and boots it', async ({ page }) => {
  await bootApp(page, WORLD)
  await openModels(page)
  await settleCatalog(page)

  // ── models.model-tile.download ───────────────────────────────────
  const granite = tile(page, 'IBM Granite 4.0 Micro')
  await granite.getByTestId('models.model-tile.download').click()

  await expect.poll(() => dlCalls(page), { timeout: 15_000 }).toEqual([
    {
      url: 'https://huggingface.co/ibm-granite/granite-4.0-micro-GGUF/resolve/main/granite-4.0-micro-Q4_K_M.gguf',
      destDir: '/tmp/lu-e2e/models',
      filename: 'granite-4.0-micro-Q4_K_M.gguf',
      expectedBytes: 2147483648,
    },
  ])

  // The built-in branch does not stop at the download: once the file is
  // there it (re)starts llama-server on exactly that GGUF, so the model is
  // chat-ready without a manual switch.
  await expect
    .poll(async () => (await engineCalls(page))
      .filter((c) => c.cmd === 'start_bundled_engine')
      .map((c) => c.modelPath), { timeout: 15_000 })
    .toContain('/tmp/lu-e2e/models/granite-4.0-micro-Q4_K_M.gguf')

  // And the tile stops offering the download.
  await expect(granite).toContainText('Installed')
})

test('Get refuses an Ollama-only model while Ollama is off, and the banner can be dismissed', async ({ page }) => {
  await bootApp(page, WORLD)
  await openModels(page)
  await settleCatalog(page)

  // ── models.install-error-banner.dismiss ──────────────────────────
  // This family exists in the catalog only as an Ollama tag, and the chat
  // picker points at the built-in engine. Pulling it into a backend the user
  // cannot see from chat is the bug this refusal exists for, so the click has
  // to produce a reason and start nothing.
  await tile(page, 'Qwen 3.6 35B MoE').getByTestId('models.model-tile.download').click()
  const banner = page.getByText(/can only run on Ollama\. Switch the chat picker/)
  await expect(banner).toBeVisible()
  expect(await dlCalls(page)).toHaveLength(0)

  await page.getByTestId('models.install-error-banner.dismiss').click()
  await expect(banner).toHaveCount(0)
})
