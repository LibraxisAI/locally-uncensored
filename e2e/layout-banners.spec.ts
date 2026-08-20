/* eslint-disable @typescript-eslint/no-explicit-any -- these specs reach into
   the app's own zustand singletons and into the untyped Tauri bridge to build
   preconditions the mocked backend cannot produce; both are `any` by nature,
   same as in tauri-mock.ts. */
import { test, expect, type Page } from '@playwright/test'
import { bootLayout, bridgeCalls } from './support/journeys/layout'
import { openNewChat } from './support/ui'

/**
 * The three things that push themselves in front of the app: the stale-model
 * banner over the header, the storage-quota toast under it, and the
 * out-of-credits dialog over everything. Plus the header's own stale chip,
 * which is the single-model version of the banner.
 *
 * Run: npx playwright test e2e/layout-banners.spec.ts
 */

const STALE_A = 'llama3:8b'
const STALE_B = 'mistral:7b'

/** Seed the health store the way the startup scan leaves it. Guarded, so a
 *  reload inside a test does not wipe what the test just did. */
async function seedStale(page: Page, models: string[]) {
  await page.addInitScript((stale) => {
    const key = 'locally-uncensored-model-health'
    if (!window.localStorage.getItem(key)) {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          state: { staleModels: stale, lastScanTime: 4102444800000, dismissed: false },
          version: 0,
        }),
      )
    }
    // Ollama must be an enabled provider or its models never reach the list.
    window.localStorage.setItem(
      'lu-providers',
      JSON.stringify({
        state: {
          providers: {
            ollama: { id: 'ollama', name: 'Ollama', enabled: true, baseUrl: 'http://localhost:11434', apiKey: '' },
          },
        },
        version: 0,
      }),
    )
  }, models)
}

const banner = (page: Page) => page.getByTestId('layout.stale-models-banner.refresh-all')

test('Refresh all re-pulls every stale model and empties the banner', async ({ page }) => {
  await seedStale(page, [STALE_A, STALE_B])
  await bootLayout(page, { ollamaModels: [STALE_A, STALE_B] })
  await expect(banner(page)).toBeVisible()
  await expect(page.getByText(/broke 2 of your models/i)).toBeVisible()

  // layout.stale-models-banner.refresh-all: every listed model goes back
  // through a real pull, and the ones that verify clean leave the banner.
  // With nothing stale left the banner itself is gone.
  await banner(page).click()
  await expect
    .poll(async () => (await bridgeCalls(page))
      .filter((c) => c.cmd === 'pull_model_stream')
      .map((c) => c.args?.name))
    .toEqual(expect.arrayContaining([STALE_A, STALE_B]))
  await expect(banner(page)).toHaveCount(0, { timeout: 20_000 })
  await expect(page.getByText(/broke 2 of your models/i)).toHaveCount(0)
})

test('Dismiss until next launch holds now and is over at the next launch', async ({ page }) => {
  await seedStale(page, [STALE_A])
  await bootLayout(page, { ollamaModels: [STALE_A] })
  await expect(banner(page)).toBeVisible()

  // layout.dismiss-until-next-launch.click: sofort weg.
  await page.getByTestId('layout.dismiss-until-next-launch.click').click()
  await expect(banner(page)).toHaveCount(0)
  await expect(page.getByText(/broke 1 of your model/i)).toHaveCount(0)

  // Und der naechste Start faengt von vorn an, genau das verspricht die
  // Beschriftung. Der Seed-Guard schreibt nicht neu, die Liste kommt aus
  // dem persistierten Store, `dismissed` bewusst nicht. Vor dem Fix in
  // modelHealthStore.partialize ueberlebte `dismissed` den Neustart und
  // ein kaputtes Modell konnte fuer immer unerwaehnt liegen bleiben.
  await page.reload()
  await expect(page.getByTestId('layout.sidebar.new-chat')).toBeVisible({ timeout: 30_000 })
  await expect(banner(page)).toBeVisible({ timeout: 20_000 })
})

test('the header stale chip re-pulls its own model and then goes away', async ({ page }) => {
  await seedStale(page, [STALE_A])
  // Let backend detection run: it is what pins Ollama's baseUrl and puts its
  // models in the composer picker, which is the only honest way to make an
  // Ollama model active.
  await bootLayout(page, { ollamaModels: [STALE_A] }, { detectBackends: true })
  // The banner covers the same models; take it out of the way first so the
  // chip is what the click lands on.
  await page.getByTestId('layout.dismiss-until-next-launch.click').click()

  // Become the user: pick the Ollama model in the composer's picker. A
  // seeded activeModel loses against boot, which adopts the built-in engine.
  await openNewChat(page)
  await page.getByTestId('models.select-chat-model.click').click()
  await page.getByTestId('models.model-row.select').filter({ hasText: STALE_A }).first().click()
  const chip = page.getByTestId('layout.stale-model-chip.refresh')
  await expect(chip).toBeVisible({ timeout: 20_000 })

  // layout.stale-model-chip.refresh: a real re-pull, then a capability probe
  // that clears the model from the shared health store, so the chip retires.
  await chip.click()
  await expect
    .poll(async () => (await bridgeCalls(page))
      .filter((c) => c.cmd === 'pull_model_stream')
      .map((c) => c.args?.name))
    .toContain(STALE_A)
  await expect(chip).toHaveCount(0, { timeout: 20_000 })
  expect(
    await page.evaluate(async () => {
      const mod: any = await import('/src/stores/modelHealthStore.ts')
      return mod.useModelHealthStore.getState().staleModels
    }),
  ).toEqual([])
})

test('the storage-quota toast closes and only a new failure brings it back', async ({ page }) => {
  await bootLayout(page)
  const quota = page.getByText(/App storage limit reached/i)
  await expect(quota).toHaveCount(0)

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('lu:storage-quota-exceeded')))
  await expect(quota).toBeVisible()

  // layout.dismiss.click-6: gone, and it stays gone while nothing new fails.
  await page.getByTestId('layout.dismiss.click-6').click()
  await expect(quota).toHaveCount(0)
  await page.waitForTimeout(800)
  await expect(quota).toHaveCount(0)

  // A fresh failed write is allowed to speak up again.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('lu:storage-quota-exceeded')))
  await expect(quota).toBeVisible()
})

test('the out-of-credits dialog either sends you to the top-up page or just closes', async ({ page }) => {
  await bootLayout(page)

  const raise = () =>
    page.evaluate(async () => {
      const mod: any = await import('/src/lib/credits-exhausted.ts')
      mod.signalCreditsExhausted()
    })

  await raise()
  const dialog = page.getByText(/You're out of credits/i).first()
  await expect(dialog).toBeVisible()

  // layout.credits-exhausted.dismiss: closes, and nothing is opened.
  const opensBefore = (await bridgeCalls(page)).filter((c) => c.cmd === 'plugin:shell|open').length
  await page.getByTestId('layout.credits-exhausted.dismiss').click()
  await expect(dialog).toHaveCount(0)
  expect((await bridgeCalls(page)).filter((c) => c.cmd === 'plugin:shell|open')).toHaveLength(opensBefore)

  // layout.credits-exhausted.open-topup: hands the top-up page to the system
  // browser and closes behind itself. The wait lets the dialog's exit
  // animation finish: re-adding the same AnimatePresence child mid-exit is a
  // frame-level race no real second refusal could hit.
  await page.waitForTimeout(400)
  await raise()
  await expect(dialog).toBeVisible()
  await page.getByTestId('layout.credits-exhausted.open-topup').click()
  await expect
    .poll(async () => (await bridgeCalls(page))
      .filter((c) => c.cmd === 'plugin:shell|open')
      .map((c) => c.args?.path))
    .toContain('https://lu-labs.ai/credits')
  await expect(dialog).toHaveCount(0)
})
