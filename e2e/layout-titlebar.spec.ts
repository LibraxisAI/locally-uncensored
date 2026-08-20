import { test, expect } from '@playwright/test'
import { bootLayout, bridgeCommands } from './support/journeys/layout'

/**
 * The custom window controls LU draws on Windows and Linux, where
 * `decorations:false` means the OS supplies none.
 *
 * What this spec can and cannot show: the buttons go through
 * `@tauri-apps/api/window`, which lands on the `plugin:window|*` commands.
 * The e2e mock answers every unmodeled `plugin:*` command with 0 and models
 * no window at all, so the window never minimises, never maximises, and
 * `isMaximized()` never reports anything the icon could follow. The three
 * inventory ids therefore stay BLOCKED (see qa/mock-requests/layout.md); what
 * is pinned here is the wiring up to that boundary, so the moment the mock
 * grows a window the three flip to proven without new test work.
 *
 * Run: npx playwright test e2e/layout-titlebar.spec.ts
 */

test('the window controls reach the Tauri window commands', async ({ page }) => {
  // Default mock platform is Windows, which is where LU draws its own strip.
  await bootLayout(page, { platform: 'windows' })
  await expect(page.getByTestId('layout.minimize.click')).toBeVisible()

  await page.getByTestId('layout.minimize.click').click()
  await expect.poll(() => bridgeCommands(page)).toContain('plugin:window|minimize')

  await page.getByTestId('layout.titlebar.toggle-maximize').click()
  await expect.poll(() => bridgeCommands(page)).toContain('plugin:window|toggle_maximize')

  await page.getByTestId('layout.close.click-2').click()
  await expect.poll(() => bridgeCommands(page)).toContain('plugin:window|close')
})

test('macOS draws no custom window buttons at all', async ({ page }) => {
  // The native traffic lights own this on mac, so LU must not add a second
  // set. This one IS fully checkable here.
  await bootLayout(page, { platform: 'mac' })
  await expect(page.getByTestId('layout.toggle-sidebar.click')).toBeVisible()
  await expect(page.getByTestId('layout.minimize.click')).toHaveCount(0)
  await expect(page.getByTestId('layout.titlebar.toggle-maximize')).toHaveCount(0)
  await expect(page.getByTestId('layout.close.click-2')).toHaveCount(0)
})
