import { test, expect } from '@playwright/test'
import { bootApp, openModels, openInstalled } from './support/journeys/models'

/**
 * QA sweep, area `models` — the Model Manager on a box where Ollama is listed
 * but not answering, plus the "Dismiss until next launch" promise on the
 * stale-model banner. Both come from FINDINGS.md as suspicions; both are
 * checked here against the running app, not against the source.
 *
 * The unreachable world is built by pointing the Ollama provider at a port
 * the bridge refuses. The model list still arrives (the mock answers /api/tags
 * by path), so the cards are there to click — every other Ollama call fails
 * exactly like it does when the daemon is down.
 */

const STALE = 'llama3:8b'
const DEAD_OLLAMA = {
  mock: { ollamaModels: [STALE] },
  providers: { ollamaEnabled: true, ollamaBaseUrl: 'http://127.0.0.1:11999', pinProviders: true },
}

test('the info button answers even when Ollama refuses the connection', async ({ page }) => {
  await bootApp(page, DEAD_OLLAMA)
  await openModels(page)
  await openInstalled(page)

  // ── models.details.click ─────────────────────────────────────────
  // FINDINGS suspicion 3: the failure was swallowed, so this click used to do
  // nothing whatsoever on a box without a reachable Ollama.
  const card = page.getByTestId('models.installed-card.activate').filter({ hasText: STALE })
  await card.getByTestId('models.details.click').click()
  await expect(page.getByRole('heading', { level: 2, name: STALE, exact: true })).toBeVisible()
  await expect(page.locator('pre')).toContainText('error')
  await page.getByTestId('ui.close.click-2').click()
})

test('a delete that fails says so, and the failure dialog closes again', async ({ page }) => {
  await bootApp(page, DEAD_OLLAMA)
  await openModels(page)
  await openInstalled(page)

  const card = page.getByTestId('models.installed-card.activate').filter({ hasText: STALE })
  await card.getByTestId('models.delete.click').click()
  await page.getByTestId('models.delete-dialog.confirm').click()

  // ── models.delete-failed.click ───────────────────────────────────
  // The confirm dialog gives way to the failure dialog, and the model is
  // still in the list because nothing was deleted.
  const failed = page.getByRole('heading', { level: 2, name: 'Delete failed', exact: true })
  await expect(failed).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Delete Model', exact: true })).toHaveCount(0)
  await page.getByTestId('models.delete-failed.click').click()
  await expect(failed).toHaveCount(0)
  await expect(card).toBeVisible()
})

test('Dismiss until next launch brings the stale-model banner back after a restart', async ({ page }) => {
  await bootApp(page, { ...DEAD_OLLAMA, health: { staleModels: [STALE] } })

  const dismiss = page.getByTestId('layout.dismiss-until-next-launch.click')
  await expect(dismiss).toBeVisible()
  await expect(page.getByRole('alert')).toContainText(STALE)

  // FINDINGS suspicion 2: the label promises the banner returns next launch,
  // but the flag was written to disk, so it never came back for that model.
  await dismiss.click()
  await expect(dismiss).toHaveCount(0)

  // A relaunch. The stale model is still on disk (the health record survives),
  // so the banner has to speak up again.
  await page.reload()
  await expect(page.getByTestId('layout.dismiss-until-next-launch.click')).toBeVisible()
  await expect(page.getByRole('alert')).toContainText(STALE)
})
