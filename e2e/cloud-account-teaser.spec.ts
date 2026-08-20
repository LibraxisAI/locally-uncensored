import { test, expect, type Page } from '@playwright/test'
import { bootApp, readSettingsState } from './support/journeys/misc'

/**
 * QA sweep, area "cloud": the Cloud discovery sheet (CloudTeaserModal) that a
 * hosted-only Create lane opens in Local mode.
 *
 * Every way out of this sheet is also the ONE-TIME retirement of the whole
 * discovery layer, so the effect under test is never "the sheet closed" alone:
 * it is that `cloudTeasersEnabled` really flipped to false in the persisted
 * settings, which is what keeps the layer from ever coming back on its own.
 */

/** Local Create with a hosted-only lane in the bar (Windows/ComfyUI host). */
async function openTeaser(page: Page) {
  await bootApp(page)
  await page.getByRole('button', { name: /^Create$/ }).click()
  const locked = page.getByRole('radio', { name: 'Upscale, runs on LU Cloud' })
  await expect(locked).toBeVisible({ timeout: 20_000 })

  // Precondition: the discovery layer is on before the first tap.
  expect((await readSettingsState(page)).settings.cloudTeasersEnabled).toBe(true)

  await locked.click()
  // The tap opened the sheet for THAT lane, with its own copy.
  await expect(page.getByRole('heading', { name: 'Upscale' })).toBeVisible()
  await expect(page.getByText(/Blow any image up to crisp 2K/)).toBeVisible()
}

const sheet = (page: Page) => page.getByTestId('cloud.teaser.panel-click-noop')

async function teasersEnabled(page: Page): Promise<boolean> {
  return (await readSettingsState(page)).settings.cloudTeasersEnabled
}

test('a click inside the sheet is swallowed instead of closing it', async ({ page }) => {
  await openTeaser(page)

  // A point inside the panel that is not a control (left edge of the demo).
  await sheet(page).click({ position: { x: 10, y: 100 } })

  // Effect: the stopPropagation held: the sheet is still up and the discovery
  // layer was NOT retired by a stray click.
  await expect(sheet(page)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Upscale' })).toBeVisible()
  expect(await teasersEnabled(page)).toBe(true)
})

test('the X retires the sheet and the discovery layer with it', async ({ page }) => {
  await openTeaser(page)

  await page.getByTestId('cloud.close.click').click()

  // Effect: sheet gone, and the persisted flag says the layer is off for good.
  await expect(sheet(page)).toHaveCount(0)
  await expect.poll(() => teasersEnabled(page)).toBe(false)
  // The lane itself is untouched: a hosted-only tool never becomes selectable.
  await expect(page.getByRole('radio', { name: 'Image', exact: true })).toBeChecked()
})

test('the dimmed area beside the sheet closes it the same way', async ({ page }) => {
  await openTeaser(page)

  await page.getByTestId('cloud.teaser.close-backdrop').click({ position: { x: 5, y: 5 } })

  // Effect: same close, same retirement.
  await expect(sheet(page)).toHaveCount(0)
  await expect.poll(() => teasersEnabled(page)).toBe(false)
})

test('"Not now" closes the sheet and turns the layer off', async ({ page }) => {
  await openTeaser(page)

  await page.getByTestId('cloud.teaser.dismiss').click()

  // Effect: sheet gone, layer retired.
  await expect(sheet(page)).toHaveCount(0)
  await expect.poll(() => teasersEnabled(page)).toBe(false)
})

test('"See plans" hands over to the cloud gate in one step', async ({ page }) => {
  await openTeaser(page)

  await page.getByTestId('cloud.teaser.open-gate').click()

  // Effect: the sheet closed, the layer is retired AND the gate took over the
  // screen (the 2.6.3 rule: no example-video detour in between).
  await expect(sheet(page)).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'LU Cloud' })).toBeVisible()
  await expect(page.getByTestId('cloud.gate.goto-plans')).toBeVisible()
  await expect.poll(() => teasersEnabled(page)).toBe(false)
  // The gate is a wall, not a switch: still Local behind it.
  expect((await readSettingsState(page)).settings.appMode).toBe('local')
})

test('BUG: "Try local" can never appear, because only locked lanes open the sheet', async ({ page }) => {
  // CloudTeaserModal.tsx:76 derives its local lane from
  // isIntentAvailable(target.intent, 'local', …), but IntentBar.tsx:56 only
  // opens the sheet for lanes isIntentLocked() says are NOT available. The two
  // predicates are each other's negation, so the branch is dead: no reachable
  // state renders `cloud.teaser.try-local`. Pinned here so the day the rule is
  // fixed, this test says so instead of the button silently staying dead.
  await openTeaser(page)
  await expect(page.getByTestId('cloud.teaser.try-local')).toHaveCount(0)

  // The other hosted-only lane behaves identically. Wait for the sheet to
  // finish its exit animation first: its backdrop covers the bar until then.
  await page.getByTestId('cloud.teaser.dismiss').click()
  await expect(page.getByTestId('cloud.teaser.close-backdrop')).toHaveCount(0)
  await page.getByRole('radio', { name: 'Erase Object, runs on LU Cloud' }).click()
  await expect(page.getByRole('heading', { name: 'Erase Object' })).toBeVisible()
  await expect(page.getByTestId('cloud.teaser.try-local')).toHaveCount(0)
})
