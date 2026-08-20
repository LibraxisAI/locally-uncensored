import { test, expect } from '@playwright/test'
import { openNewChat } from './support/ui'
import { routeCloud } from './support/cloud-mock'
import { bootApp, countProxy } from './support/journeys/models'

/**
 * QA sweep, area `models` — the chat model picker in the composer: open and
 * close it, switch the model it routes chat at, free the VRAM of every loaded
 * Ollama model, and take the Cloud row that turns the picker into the gate.
 *
 * The picker is where a seeded activeModel loses against boot (the app adopts
 * whatever the engine reports), so every model change here goes through the
 * real click a user makes.
 */

const OLLAMA_A = 'llama3:8b'
const OLLAMA_B = 'mistral:7b'
const WORLD = {
  mock: { ollamaModels: [OLLAMA_A, OLLAMA_B] },
  providers: { ollamaEnabled: true },
}

test('the picker opens, closes, and the picked row becomes the chat model', async ({ page }) => {
  await bootApp(page, WORLD)
  await openNewChat(page)

  const trigger = page.getByTestId('models.select-chat-model.click')
  const rows = page.getByTestId('models.model-row.select')

  // ── models.select-chat-model.click ───────────────────────────────
  await expect(rows).toHaveCount(0)
  await trigger.click()
  await expect(rows.filter({ hasText: OLLAMA_B })).toBeVisible()
  await trigger.click()
  await expect(rows).toHaveCount(0)

  // ── models.model-row.select ──────────────────────────────────────
  // Picking a row must both close the panel and re-point the trigger, which
  // is what the send path reads.
  await trigger.click()
  await expect(trigger).not.toContainText('mistral')
  await rows.filter({ hasText: OLLAMA_B }).click()
  await expect(rows).toHaveCount(0)
  await expect(trigger).toContainText('mistral')

  // And it stuck: reopening shows the same model as the highlighted one.
  await trigger.click()
  await expect(rows.filter({ hasText: OLLAMA_B })).toHaveClass(/bg-black\/\[0\.06\]/)
})

test('Unload all really asks Ollama to drop every resident model', async ({ page }) => {
  await bootApp(page, WORLD)
  await openNewChat(page)

  await page.getByTestId('models.select-chat-model.click').click()
  const unloadAll = page.getByTestId('models.unload-all.click')
  await expect(unloadAll).toContainText('Unload all models')

  // ── models.unload-all.click ──────────────────────────────────────
  // Two models are resident, so two keep_alive:0 calls have to go out — the
  // label alone would prove nothing, it is set by the click either way.
  const before = await countProxy(page, '/api/generate')
  await unloadAll.click()
  await expect(unloadAll).toContainText('Unloaded')
  await expect
    .poll(() => countProxy(page, '/api/generate'), { timeout: 10_000 })
    .toBe(before + 2)
})

test('the Cloud row closes the picker and opens the plan gate', async ({ page }) => {
  await routeCloud(page, { license: 'none' })
  await bootApp(page, WORLD)
  await openNewChat(page)

  await page.getByTestId('models.select-chat-model.click').click()

  // ── models.runs-on-lu-cloud-tap-to-see-plans.click-2 ─────────────
  // Signed out, so the section is the single collective row rather than a
  // list of hosted models.
  const cloudRow = page.getByTestId('models.runs-on-lu-cloud-tap-to-see-plans.click-2')
  await expect(cloudRow).toBeVisible()
  await cloudRow.click()

  await expect(page.getByTestId('models.model-row.select')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Get LU Cloud/i })).toBeVisible()
})
