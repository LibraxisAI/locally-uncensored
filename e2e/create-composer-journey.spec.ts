import { test, expect, type Page } from '@playwright/test'
import { bootCloudCreate, createButton, dismissRetentionNotice, promptField } from './support/journeys/create'

/**
 * QA sweep, area `create`, journey 5: the composer's own two controls that
 * only exist mid-flight or after a run.
 *
 * Prompt history had NO writer anywhere in the app: `addToPromptHistory`
 * existed on the store and was called by nothing, so the list was always
 * empty, and PromptHistory returns null on an empty list. The button and its
 * dropdown could not be reached at all. The Composer now records the prompt at
 * submit (the one point both backends pass through), and this spec is what
 * holds that shut.
 *
 * Cancel is the other one: it only exists while a job is in flight, and the
 * shared cloud mock finishes on the first poll, so this journey serves a job
 * that stays queued.
 */

const CORS_JSON = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'content-type': 'application/json',
}

/** A job that never finishes, so the run stays cancellable. */
async function routeStuckJob(page: Page) {
  await page.route(/https:\/\/lu-labs\.ai\/api\/jobs\/job-[\w-]+$/, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS_JSON })
    const id = new URL(route.request().url()).pathname.split('/').pop()!
    return route.fulfill({
      status: 200,
      headers: CORS_JSON,
      body: JSON.stringify({
        job: {
          id, kind: 'image', model: 'flux-schnell', provider: 'wavespeed', status: 'running',
          result_url: null, attestation: null, cost_units: 300,
          created_at: new Date().toISOString(), completed_at: null, error: null,
        },
      }),
    })
  })
}

test('composer: submitting fills the prompt history, and an entry re-applies it', async ({ page }) => {
  await bootCloudCreate(page)
  await dismissRetentionNotice(page)

  // Nothing submitted yet: the button does not exist, by design.
  await expect(page.getByTestId('create.prompt-history.click')).toHaveCount(0)

  await promptField(page).fill('a lighthouse at dusk, cinematic')
  await createButton(page).click()
  await expect(page.locator('img[src*="/e2e/result.png"]').first()).toBeVisible({ timeout: 30_000 })

  await promptField(page).fill('a red barn in a wheat field')
  await createButton(page).click()

  // ── create.prompt-history.click ──
  // One submit is enough to bring the button into existence; opening it must
  // mount the list of what was actually sent, newest first.
  const historyBtn = page.getByTestId('create.prompt-history.click')
  await expect(historyBtn).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('create.prompt-history-entry.apply')).toHaveCount(0)
  await historyBtn.click()
  const entries = page.getByTestId('create.prompt-history-entry.apply')
  await expect(entries).toHaveCount(2)
  await expect(entries.first()).toHaveText('a red barn in a wheat field')
  await expect(entries.nth(1)).toHaveText('a lighthouse at dusk, cinematic')

  // ── create.prompt-history-entry.apply ──
  // Picking the OLDER entry writes it back into the field (which still holds
  // the newer prompt) and shuts the list behind it.
  await expect(promptField(page)).toHaveValue('a red barn in a wheat field')
  await entries.nth(1).click()
  await expect(promptField(page)).toHaveValue('a lighthouse at dusk, cinematic')
  await expect(entries).toHaveCount(0)

  // Toggling is the same button, so it must not latch open.
  await historyBtn.click()
  await expect(entries).toHaveCount(2)
  await historyBtn.click()
  await expect(entries).toHaveCount(0)
})

test('composer: a running job turns Create into Cancel, and Cancel really stops it', async ({ page }) => {
  await bootCloudCreate(page, { license: 'active', access: true, mediaLive: true }, undefined, routeStuckJob)
  await dismissRetentionNotice(page)

  await promptField(page).fill('a lighthouse at dusk, cinematic')
  await expect(createButton(page)).toBeEnabled()
  await createButton(page).click()

  // ── create.generation.cancel ──
  // The button replaces Create in place while the job runs. It carries a
  // 400 ms guard so the second half of a double click cannot kill the run it
  // just started, so press it after the guard has expired. The proof is
  // the composer flipping back to an idle, ready-to-submit Create.
  const cancel = page.getByTestId('create.generation.cancel')
  await expect(cancel).toBeVisible({ timeout: 20_000 })
  await expect(createButton(page)).toHaveCount(0)

  // Sit out the double-click guard, then press it once.
  await page.waitForTimeout(600)
  await cancel.click()
  await expect(createButton(page)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('create.generation.cancel')).toHaveCount(0)
  await expect(createButton(page)).toBeEnabled()
  // Nothing was written to the gallery, so the run really stopped and did not
  // quietly finish behind the cancel.
  await expect(page.locator('img[src*="/e2e/result.png"]')).toHaveCount(0)
})
