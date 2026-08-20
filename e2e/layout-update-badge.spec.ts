/* eslint-disable @typescript-eslint/no-explicit-any -- these specs reach into
   the app's own zustand singletons and into the untyped Tauri bridge to build
   preconditions the mocked backend cannot produce; both are `any` by nature,
   same as in tauri-mock.ts. */
import { test, expect, type Page } from '@playwright/test'
import { bootLayout, bridgeCommands } from './support/journeys/layout'
import { seedOnboardingDone } from './support/cloud-mock'

/**
 * The update badge and its panel. A pending update is seeded the way the
 * checker persists one (localStorage `lu-update-checker-v2`), and the update
 * server is unreachable, which is not a shortcut but the branch the panel is
 * specified against: without a live `Update` handle in this process both
 * Download and Restart have to say so instead of dying silently.
 *
 * Run: npx playwright test e2e/layout-update-badge.spec.ts
 */

const LATEST = '99.0.0'

async function seedPendingUpdate(page: Page) {
  await page.addInitScript((latest) => {
    window.localStorage.setItem(
      'lu-update-checker-v2',
      JSON.stringify({
        state: {
          latestVersion: latest,
          updateAvailable: true,
          releaseNotes: 'Seeded release notes.',
          autoDownload: false,
          lastChecked: null,
        },
        version: 0,
      }),
    )
  }, LATEST)
}

/** Put the badge back on offer after a Dismiss, via the store's own action. */
async function clearDismiss(page: Page) {
  await page.evaluate(async () => {
    const mod: any = await import('/src/stores/updateStore.ts')
    mod.useUpdateStore.getState().clearDismiss()
  })
}

async function setDownloadStatus(page: Page, status: string) {
  await page.evaluate(async (next) => {
    const mod: any = await import('/src/stores/updateStore.ts')
    mod.useUpdateStore.setState({ downloadStatus: next, downloadProgress: next === 'downloaded' ? 100 : 0 })
  }, status)
}

const badge = (page: Page) => page.getByTestId('layout.update-badge.toggle-panel')

test('the badge opens its panel, and Later drops the badge for this version', async ({ page }) => {
  await seedPendingUpdate(page)
  await bootLayout(page)

  // layout.update-badge.toggle-panel: the panel with both version numbers
  // opens and closes again.
  await expect(badge(page)).toContainText(`Update to v${LATEST}`)
  await expect(page.getByTestId('layout.update-panel.download')).toHaveCount(0)
  await badge(page).click()
  await expect(page.getByTestId('layout.update-panel.download')).toBeVisible()
  await expect(page.getByText(`v${LATEST}`, { exact: true })).toBeVisible()
  await badge(page).click()
  await expect(page.getByTestId('layout.update-panel.download')).toHaveCount(0)
  await expect(badge(page)).toBeVisible()

  // layout.update-panel.later-idle: closes the panel AND retires the badge
  // until a newer version turns up.
  await badge(page).click()
  await page.getByTestId('layout.update-panel.later-idle').click()
  await expect(page.getByTestId('layout.update-panel.download')).toHaveCount(0)
  await expect(badge(page)).toHaveCount(0)

  // layout.dismiss.click-7: the X in the panel header is the same retire,
  // reachable without scrolling to the buttons.
  await clearDismiss(page)
  await expect(badge(page)).toBeVisible()
  await badge(page).click()
  await page.getByTestId('layout.dismiss.click-7').click()
  await expect(page.getByTestId('layout.update-panel.download')).toHaveCount(0)
  await expect(badge(page)).toHaveCount(0)
})

test('Download, Retry and Dismiss behave when the update server is unreachable', async ({ page }) => {
  await seedPendingUpdate(page)
  await bootLayout(page)
  await badge(page).click()

  // layout.update-panel.download: with no reachable update server the
  // panel has to name the reason instead of doing nothing.
  await page.getByTestId('layout.update-panel.download').click()
  await expect(page.getByText('Update Error')).toBeVisible()
  await expect(page.getByText(/Could not reach the update server/i)).toBeVisible()
  await expect(page.getByTestId('layout.update-panel.retry-download')).toBeVisible()

  // layout.update-panel.retry-download: a retry really goes back out to the
  // updater, it does not just repaint the error.
  const checksBefore = (await bridgeCommands(page)).filter((c) => c === 'plugin:updater|check').length
  await page.getByTestId('layout.update-panel.retry-download').click()
  await expect
    .poll(async () => (await bridgeCommands(page)).filter((c) => c === 'plugin:updater|check').length)
    .toBeGreaterThan(checksBefore)

  // layout.update-panel.dismiss-error: gives up on this version: panel
  // closed, badge gone.
  await page.getByTestId('layout.update-panel.dismiss-error').click()
  await expect(page.getByTestId('layout.update-panel.retry-download')).toHaveCount(0)
  await expect(badge(page)).toHaveCount(0)
})

test('a downloaded update offers Restart, and Later keeps the badge standing', async ({ page }) => {
  await seedPendingUpdate(page)
  await bootLayout(page)
  await setDownloadStatus(page, 'downloaded')
  await expect(badge(page)).toContainText('Restart to update')

  // layout.update-panel.later-downloaded: unlike the idle Later, this one
  // must NOT retire the badge: the update is on disk and still waiting.
  await badge(page).click()
  await expect(page.getByTestId('layout.update-panel.install-restart')).toBeVisible()
  await page.getByTestId('layout.update-panel.later-downloaded').click()
  await expect(page.getByTestId('layout.update-panel.install-restart')).toHaveCount(0)
  await expect(badge(page)).toContainText('Restart to update')

  // layout.update-panel.install-restart: the download handle died with the
  // process that made it, so the button says exactly that rather than
  // pretending to restart.
  await badge(page).click()
  await page.getByTestId('layout.update-panel.install-restart').click()
  await expect(page.getByText(/downloaded update was lost when the app restarted/i)).toBeVisible()
  await expect(page.getByTestId('layout.update-panel.retry-download')).toBeVisible()
})

test('in the browser build the panel sends you to the release page instead', async ({ page }) => {
  // No Tauri bridge here on purpose: this is the dev/browser build, where the
  // app cannot install anything itself.
  await page.route('**/api.github.com/repos/**/releases/latest', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tag_name: `v${LATEST}`, body: 'Browser build notes.' }),
    }),
  )
  // Keep the popup off the real internet: github.com/releases/latest
  // redirects to the tagged release, which would rewrite the URL we want to
  // read back.
  await page.context().route('https://github.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' }),
  )
  await seedOnboardingDone(page)
  await seedPendingUpdate(page)
  await page.goto('/')
  await expect(badge(page)).toBeVisible({ timeout: 30_000 })
  await badge(page).click()

  // No in-app download offer without Tauri.
  await expect(page.getByTestId('layout.update-panel.download')).toHaveCount(0)

  // layout.update-panel.later-dev: retires the badge, same as Later does on
  // the desktop build.
  await page.getByTestId('layout.update-panel.later-dev').click()
  await expect(page.getByTestId('layout.update-panel.open-release-page')).toHaveCount(0)
  await expect(badge(page)).toHaveCount(0)

  // layout.update-panel.open-release-page: opens the GitHub release in a new
  // tab and closes the panel behind it.
  await clearDismiss(page)
  await badge(page).click()
  const [released] = await Promise.all([
    page.context().waitForEvent('page'),
    page.getByTestId('layout.update-panel.open-release-page').click(),
  ])
  expect(released.url()).toBe('https://github.com/purpledoubled/locally-uncensored/releases/latest')
  await expect(page.getByTestId('layout.update-panel.open-release-page')).toHaveCount(0)
})
