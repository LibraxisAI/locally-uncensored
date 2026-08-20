import { test, expect } from '@playwright/test'
import { openNewChat } from './support/ui'
import {
  bootApp, openModels, openInstalled, BUILTIN_MODEL,
  countProxy, modelCalls,
} from './support/journeys/models'

/**
 * QA sweep, area `models` — the Model Manager as a user walks it: switch
 * tabs, switch the category rail, search and clear, refresh, open a model's
 * details, activate one, delete one, and pull one by name.
 *
 * Every verdict below is the state AFTER the click, never the presence of the
 * control. Where the shared Tauri mock cannot show the deeper effect (its
 * Ollama model list is a constant, so a deleted model never leaves the list)
 * the proof drops to the bridge boundary — the exact call the click issued —
 * and says so in a comment.
 *
 * World: Windows (the only platform where the Models page still owns the
 * ComfyUI-backed image/video lane), Ollama on with two models, the built-in
 * engine on with its bundled GGUF. Three text models, one of them managed.
 */

const OLLAMA_A = 'llama3:8b'
const OLLAMA_B = 'mistral:7b'

const WORLD = {
  mock: { ollamaModels: [OLLAMA_A, OLLAMA_B] },
  providers: { ollamaEnabled: true },
}

test('the manager tab, rail, search and refresh each change what the page shows', async ({ page }) => {
  await bootApp(page, WORLD)
  await openNewChat(page)
  await openModels(page)

  // The page opens on Get new (most opens are to install something), so the
  // catalog grid is what is on screen and no installed card exists yet.
  await expect(page.getByTestId('models.installed-card.activate')).toHaveCount(0)
  await expect(page.getByTestId('models.model-tile.download').first()).toBeVisible()

  // ── models.tab-installed.select ──────────────────────────────────
  await openInstalled(page)
  const cards = page.getByTestId('models.installed-card.activate')
  await expect(cards).toHaveCount(3)
  await expect(cards.filter({ hasText: OLLAMA_A })).toBeVisible()
  await expect(page.getByTestId('models.model-tile.download')).toHaveCount(0)

  // ── models.clear-search.click ────────────────────────────────────
  // Type first so the X exists at all, and prove the filter really bit.
  const search = page.getByPlaceholder('Search models…')
  await search.fill('llama')
  await expect(cards).toHaveCount(1)
  await page.getByTestId('models.clear-search.click').click()
  await expect(search).toHaveValue('')
  await expect(cards).toHaveCount(3)
  await expect(page.getByTestId('models.clear-search.click')).toHaveCount(0)

  // ── models.refresh.click ─────────────────────────────────────────
  // "The list is re-read": the only honest proof is that the click issued a
  // fresh round trip to Ollama's /api/tags, since the mock's list is a
  // constant and no visible count can move.
  const tagsBefore = await countProxy(page, '/api/tags')
  await page.getByTestId('models.refresh.click').click()
  await expect
    .poll(() => countProxy(page, '/api/tags'), { timeout: 10_000 })
    .toBeGreaterThan(tagsBefore)
  await expect(cards).toHaveCount(3)

  // ── models.category-rail.select ──────────────────────────────────
  // Chat → Image swaps BOTH views over to the image lane: the chat cards are
  // gone and the ComfyUI-is-down explanation takes their place.
  await page.getByTestId('models.category-rail.select').filter({ hasText: 'Image' }).click()
  await expect(cards).toHaveCount(0)
  await expect(page.getByText(/Start ComfyUI to see your image models/i)).toBeVisible()

  // ── models.comfyui-hint-go-to-create.click ───────────────────────
  await page.getByTestId('models.comfyui-hint-go-to-create.click').click()
  await expect(page.getByRole('heading', { name: 'Models', exact: true })).toHaveCount(0)
  await expect(
    page.getByTestId('layout.header-nav.open-view').filter({ hasText: 'Create' }),
  ).toHaveClass(/text-gray-900/)

  // ── models.tab-get-new.select ────────────────────────────────────
  // Back on the Models page the rail is still on Image, so Get new must show
  // the image BUNDLE grid — a different list than the chat tiles above.
  await openModels(page)
  await page.getByTestId('models.tab-get-new.select').click()
  await expect(page.getByTestId('models.bundle-tile.install').first()).toBeVisible()
  await expect(page.getByTestId('models.installed-card.activate')).toHaveCount(0)

  // ── models.back-to-chat.click ────────────────────────────────────
  await page.getByTestId('models.back-to-chat.click').click()
  await expect(page.getByRole('heading', { name: 'Models', exact: true })).toHaveCount(0)
  await expect(page.locator('textarea').first()).toBeVisible()
})

test('details, activate and delete act on the model of the row they sit in', async ({ page }) => {
  await bootApp(page, WORLD)
  await openModels(page)
  await openInstalled(page)

  const cards = page.getByTestId('models.installed-card.activate')
  const builtinCard = cards.filter({ hasText: 'qwen2.5-0.5b' })
  const cardB = cards.filter({ hasText: OLLAMA_B })

  // ── models.details.click ─────────────────────────────────────────
  // FINDINGS suspicion 3: the info click routed EVERY model through Ollama's
  // /api/show and swallowed the failure, so on a box without Ollama the
  // button did nothing at all. A built-in GGUF is not an Ollama model, so its
  // details must come from the record the list already holds.
  await builtinCard.getByTestId('models.details.click').click()
  const infoTitle = page.getByRole('heading', { name: BUILTIN_MODEL, exact: true })
  await expect(infoTitle).toBeVisible()
  await expect(page.locator('pre')).toContainText('Built-in Engine')
  await page.getByTestId('ui.close.click-2').click()
  await expect(infoTitle).toHaveCount(0)

  // ── models.installed-card.activate ───────────────────────────────
  // Boot already activated some row; clicking this one must MOVE the Active
  // marker over to it, not add a second one.
  await expect(cardB).not.toContainText('Active')
  await cardB.click()
  await expect(cardB).toContainText('Active')
  await expect(cards.filter({ hasText: 'Active' })).toHaveCount(1)

  // ── models.delete.click ──────────────────────────────────────────
  // Opens the confirmation naming THIS model, and deletes nothing yet.
  await cardB.getByTestId('models.delete.click').click()
  const confirmTitle = page.getByRole('heading', { name: 'Delete Model', exact: true })
  await expect(confirmTitle).toBeVisible()
  await expect(page.getByText(/Are you sure you want to delete/)).toContainText(OLLAMA_B)
  expect(await countProxy(page, '/api/delete')).toBe(0)

  // ── models.delete-dialog.cancel ──────────────────────────────────
  await page.getByTestId('models.delete-dialog.cancel').click()
  await expect(confirmTitle).toHaveCount(0)
  await expect(cardB).toBeVisible()
  expect(await countProxy(page, '/api/delete')).toBe(0)

  // ── models.delete-dialog.confirm ─────────────────────────────────
  // The mock's Ollama model list is a constant, so the row cannot disappear
  // here. What CAN be proven is that the confirm really issued the delete
  // against Ollama and closed the dialog — the cancel above did neither.
  await cardB.getByTestId('models.delete.click').click()
  await expect(confirmTitle).toBeVisible()
  await page.getByTestId('models.delete-dialog.confirm').click()
  await expect.poll(() => countProxy(page, '/api/delete'), { timeout: 10_000 }).toBe(1)
  await expect(page.getByTestId('models.delete-dialog.confirm')).toHaveCount(0)
})

test('Pull opens the by-name dialog and the submit really starts that pull', async ({ page }) => {
  await bootApp(page, WORLD)
  await openModels(page)

  // ── models.pull-any-ollama-model-by-name.click ───────────────────
  await expect(page.getByTestId('models.pull-dialog.submit')).toHaveCount(0)
  await page.getByTestId('models.pull-any-ollama-model-by-name.click').click()
  const nameField = page.getByPlaceholder(/llama3\.1:8b/)
  await expect(nameField).toBeVisible()
  await expect(page.getByTestId('models.pull-dialog.submit')).toBeDisabled()

  // ── models.pull-dialog.submit ────────────────────────────────────
  await nameField.fill('phi3:mini')
  await expect(page.getByTestId('models.pull-dialog.submit')).toBeEnabled()
  await page.getByTestId('models.pull-dialog.submit').click()

  // The pull actually left the app: the bridge saw pull_model_stream for
  // exactly this name. The field clears, and the dialog stays open so the
  // user can queue a second model.
  await expect
    .poll(async () => (await modelCalls(page)).filter((c) => c.cmd === 'pull_model_stream').map((c) => c.name))
    .toEqual(['phi3:mini'])
  await expect(nameField).toHaveValue('')
  await expect(nameField).toBeVisible()
})

test('with nothing installed the empty state hands the user to the catalog', async ({ page }) => {
  // A box with Ollama on but empty, and the built-in engine switched off, so
  // the app really knows about zero models. Provider detection is pinned or
  // the boot probe would switch the built-in engine back on.
  await bootApp(page, {
    providers: { ollamaEnabled: true, builtinEnabled: false, pinProviders: true },
  })
  await openModels(page)
  await openInstalled(page)

  // ── models.empty-state-discover.click ────────────────────────────
  await expect(page.getByText(/No models installed yet/)).toBeVisible()
  await expect(page.getByTestId('models.model-tile.download')).toHaveCount(0)
  await page.getByTestId('models.empty-state-discover.click').click()
  await expect(page.getByText(/No models installed yet/)).toHaveCount(0)
  await expect(page.getByTestId('models.model-tile.download').first()).toBeVisible()
})
