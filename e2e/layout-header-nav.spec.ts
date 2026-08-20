import { test, expect } from '@playwright/test'
import { DEFAULT_ASSISTANT_REPLY } from './support/tauri-mock'
import { bootLayout, chatRows, newChatRow } from './support/journeys/layout'

/**
 * The header as a user drives it: fold the sidebar away, flip the theme,
 * walk the main navigation on a wide window, and walk the same navigation
 * out of the three-dot menu once the window is too narrow for it.
 *
 * Run: npx playwright test e2e/layout-header-nav.spec.ts
 */

const isDark = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.classList.contains('dark'))

test('the header folds the sidebar and flips the theme', async ({ page }) => {
  await bootLayout(page)

  // layout.toggle-sidebar.click: the whole aside goes away and comes back.
  await expect(page.getByTestId('layout.sidebar.new-chat')).toBeVisible()
  await page.getByTestId('layout.toggle-sidebar.click').click()
  await expect(page.getByTestId('layout.sidebar.new-chat')).toHaveCount(0)
  await page.getByTestId('layout.toggle-sidebar.click').click()
  await expect(page.getByTestId('layout.sidebar.new-chat')).toBeVisible()

  // layout.header.toggle-theme: the root class is what every dark: rule in
  // the app hangs off, and the button's own icon has to follow it.
  const themeButton = page.getByTestId('layout.header.toggle-theme')
  const startedDark = await isDark(page)
  await expect(themeButton).toHaveAttribute('title', startedDark ? 'Light Mode' : 'Dark Mode')
  await themeButton.click()
  await expect.poll(() => isDark(page)).toBe(!startedDark)
  await expect(themeButton).toHaveAttribute('title', startedDark ? 'Dark Mode' : 'Light Mode')
  await themeButton.click()
  await expect.poll(() => isDark(page)).toBe(startedDark)
  await expect(themeButton).toHaveAttribute('title', startedDark ? 'Light Mode' : 'Dark Mode')
})

test('the wide navigation switches views, enters compare, and the logo goes home', async ({ page }) => {
  await bootLayout(page)
  await newChatRow(page)
  await page.locator('textarea').first().fill('header journey')
  await page.locator('textarea').first().press('Enter')
  await expect(page.getByText(DEFAULT_ASSISTANT_REPLY).first()).toBeVisible({ timeout: 30_000 })

  const wideNav = page.getByTestId('layout.header-nav.open-view')

  // layout.header-nav.open-view: each entry hands the main area to a
  // different screen.
  await wideNav.filter({ hasText: 'Settings' }).click()
  await expect(page.getByTestId('settings.section.toggle').first()).toBeVisible()
  await wideNav.filter({ hasText: 'Models' }).click()
  await expect(page.getByTestId('models.back-to-chat.click')).toBeVisible()
  await expect(page.getByTestId('settings.section.toggle')).toHaveCount(0)

  // layout.header-nav.open-compare: compare takes the whole view over and
  // the sidebar goes with it.
  await page.getByTestId('layout.header-nav.open-compare').click()
  await expect(page.getByTestId('chat.abcompare-exit.click')).toBeVisible()
  await expect(page.getByTestId('layout.sidebar.new-chat')).toHaveCount(0)

  // ... and the same nav has to get you back OUT of compare, not just
  // change the view behind it.
  await wideNav.filter({ hasText: 'Settings' }).click()
  await expect(page.getByTestId('chat.abcompare-exit.click')).toHaveCount(0)
  await expect(page.getByTestId('settings.section.toggle').first()).toBeVisible()

  // layout.header.logo-home: back to chat, out of compare, and with the
  // open conversation deselected, so the empty home screen is what shows.
  await page.getByTestId('layout.header-nav.open-compare').click()
  await expect(page.getByTestId('chat.abcompare-exit.click')).toBeVisible()
  await page.getByTestId('layout.header.logo-home').click()
  await expect(page.getByTestId('chat.abcompare-exit.click')).toHaveCount(0)
  await expect(page.getByText(DEFAULT_ASSISTANT_REPLY)).toHaveCount(0)
  await expect(chatRows(page)).toHaveCount(1)
})

test('the narrow window moves the same navigation into the three-dot menu', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 760 })
  await bootLayout(page)

  // Below the lg breakpoint the written-out nav is display:none and the dots
  // take over.
  await expect(page.getByTestId('layout.header-nav.open-view').first()).toBeHidden()
  await expect(page.getByTestId('layout.more.click')).toBeVisible()

  // layout.more.click: opens the menu, and clicking it again closes it.
  await expect(page.getByTestId('layout.header-more-menu.open-view')).toHaveCount(0)
  await page.getByTestId('layout.more.click').click()
  await expect(page.getByTestId('layout.header-more-menu.open-view').first()).toBeVisible()
  await page.getByTestId('layout.more.click').click()
  await expect(page.getByTestId('layout.header-more-menu.open-view')).toHaveCount(0)

  // layout.header-more-menu.open-view: switches the view and shuts the
  // menu behind itself.
  await page.getByTestId('layout.more.click').click()
  await page.getByTestId('layout.header-more-menu.open-view').filter({ hasText: 'Settings' }).click()
  await expect(page.getByTestId('settings.section.toggle').first()).toBeVisible()
  await expect(page.getByTestId('layout.header-more-menu.open-view')).toHaveCount(0)

  // layout.header-more-menu.open-compare: same deal, into compare.
  await page.getByTestId('layout.more.click').click()
  await page.getByTestId('layout.header-more-menu.open-compare').click()
  await expect(page.getByTestId('chat.abcompare-exit.click')).toBeVisible()
  await expect(page.getByTestId('settings.section.toggle')).toHaveCount(0)
  await expect(page.getByTestId('layout.header-more-menu.open-compare')).toHaveCount(0)

  // ... and the menu entry has to leave compare again too.
  await page.getByTestId('layout.more.click').click()
  await page.getByTestId('layout.header-more-menu.open-view').filter({ hasText: 'Chat' }).click()
  await expect(page.getByTestId('chat.abcompare-exit.click')).toHaveCount(0)
  await expect(page.getByTestId('layout.sidebar.new-chat')).toBeVisible()
})
