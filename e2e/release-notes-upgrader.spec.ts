import { test, expect } from '@playwright/test'
import { APP_VERSION, bootUpgrader, readNotesVersion } from './support/journeys/onboarding'

/**
 * Journey: the "What is new" sheet an UPGRADER meets.
 *
 * The sheet is defined by an absence, not a presence: onboardingDone is true
 * (so the wizard is behind this user) while lu_release_notes carries no stamp
 * for this build. That is exactly what an update looks like: the wizard never
 * ran, so nothing stamped, and it is why the whole rest of the suite seeds the
 * stamp: without it the sheet stands over every control.
 *
 * Every close path has the same contract: the version is stamped, so the sheet
 * is gone for THIS build and stays gone across a restart. That last half is
 * asserted with a real page reload, because a sheet that only hides in memory
 * would come straight back.
 */

const sheet = 'release.notes.dismiss'

test('an upgrader gets the sheet: details expand, a click inside keeps it open, the backdrop closes it', async ({ page }) => {
  await bootUpgrader(page)

  await expect(page.getByTestId(sheet)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('heading', { name: /What is new/i })).toBeVisible()
  expect(await readNotesVersion(page)).toBeNull()

  // release.notes.toggle-details: the collapsed sections actually unfold and
  // the label flips; collapsing puts them away again.
  const localSection = page.getByText('Local', { exact: true })
  await expect(localSection).toHaveCount(0)
  await page.getByTestId('release.notes.toggle-details').click()
  await expect(localSection).toBeVisible()
  await expect(page.getByTestId('release.notes.toggle-details')).toHaveText(/Hide details/i)
  await page.getByTestId('release.notes.toggle-details').click()
  await expect(localSection).toHaveCount(0)
  await expect(page.getByTestId('release.notes.toggle-details')).toHaveText(/Show all changes/i)

  // release.notes.panel-click-noop: the panel swallows the click so the
  // backdrop handler underneath never fires. Sheet stays, nothing is stamped.
  await page.getByTestId('release.notes.panel-click-noop').click({ position: { x: 180, y: 60 } })
  await expect(page.getByTestId(sheet)).toBeVisible()
  expect(await readNotesVersion(page)).toBeNull()

  // release.notes.close-backdrop: clicked well clear of the panel, which is
  // the only spot where the backdrop is actually the top element.
  await page.getByTestId('release.notes.close-backdrop').click({ position: { x: 12, y: 12 } })
  await expect(page.getByTestId(sheet)).toHaveCount(0)
  expect(await readNotesVersion(page)).toBe(APP_VERSION)
})

test('the X closes the sheet for this build and it does not return after a restart', async ({ page }) => {
  await bootUpgrader(page)
  await expect(page.getByTestId('release.close.click')).toBeVisible({ timeout: 20_000 })

  // release.close.click
  await page.getByTestId('release.close.click').click()
  await expect(page.getByTestId(sheet)).toHaveCount(0)
  expect(await readNotesVersion(page)).toBe(APP_VERSION)

  // The stamp is what makes it stick, so prove it over a real reload.
  await page.reload()
  await expect(page.getByRole('button', { name: /New Chat/i })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId(sheet)).toHaveCount(0)
  await expect(page.getByTestId('release.close.click')).toHaveCount(0)
})

test('"Got it" closes the sheet for this build and it does not return after a restart', async ({ page }) => {
  await bootUpgrader(page)
  await expect(page.getByTestId(sheet)).toBeVisible({ timeout: 20_000 })

  // release.notes.dismiss
  await page.getByTestId(sheet).click()
  await expect(page.getByTestId(sheet)).toHaveCount(0)
  expect(await readNotesVersion(page)).toBe(APP_VERSION)

  await page.reload()
  await expect(page.getByRole('button', { name: /New Chat/i })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId(sheet)).toHaveCount(0)
})
