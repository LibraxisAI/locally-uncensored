import { test, expect } from '@playwright/test'
import { DEFAULT_ASSISTANT_REPLY } from './support/tauri-mock'
import { bootLayout, chatRows, newChatRow, openRowMenu } from './support/journeys/layout'

/**
 * The sidebar conversation list, walked end to end: create a chat, put a real
 * exchange in it, create a second one, switch between them, rename from both
 * the hover pencil and the right-click menu, and delete from both.
 *
 * Run: npx playwright test e2e/layout-sidebar-chats.spec.ts
 */

test('the sidebar creates, opens, renames and deletes conversations', async ({ page }) => {
  await bootLayout(page)
  await expect(chatRows(page)).toHaveCount(0)

  // layout.sidebar.new-chat: a model is active, so the click has to produce
  // a real conversation and land in the chat view with a usable composer.
  await newChatRow(page)
  await expect(chatRows(page)).toHaveCount(1)
  await expect(page.locator('textarea').first()).toBeVisible()

  // Give the first conversation content, so "which chat is open" is
  // answerable from the main view instead of from a highlight colour.
  await page.locator('textarea').first().fill('first chat')
  await page.locator('textarea').first().press('Enter')
  await expect(page.getByText(DEFAULT_ASSISTANT_REPLY).first()).toBeVisible({ timeout: 30_000 })

  // A second, empty conversation. New chats are prepended, so index 0 is the
  // empty one and index 1 carries the exchange.
  await newChatRow(page)
  await expect(chatRows(page)).toHaveCount(2)
  await expect(page.getByText(DEFAULT_ASSISTANT_REPLY)).toHaveCount(0)

  // layout.chat-row.open: clicking the older row brings its history back.
  await chatRows(page).nth(1).click()
  await expect(page.getByText(DEFAULT_ASSISTANT_REPLY).first()).toBeVisible()

  // layout.rename-chat.click: the row turns into an input carrying the
  // current title, plus confirm and cancel.
  await chatRows(page).nth(1).hover()
  await chatRows(page).nth(1).getByTestId('layout.rename-chat.click').click()
  // addMessage retitles a still-unnamed chat after its first user message,
  // so the field opens on "first chat", not on "New Chat".
  const editor = page.getByTestId('layout.chat-row.rename-input-guard')
  await expect(editor).toHaveValue('first chat')
  await expect(page.getByTestId('layout.chat-row.confirm-rename')).toBeVisible()
  await expect(page.getByTestId('layout.chat-row.cancel-rename')).toBeVisible()

  // layout.chat-row.confirm-rename: the typed title replaces the old one.
  await editor.fill('Renamed Alpha')
  await page.getByTestId('layout.chat-row.confirm-rename').click()
  await expect(page.getByTestId('layout.chat-row.rename-input-guard')).toHaveCount(0)
  await expect(chatRows(page).nth(1)).toContainText('Renamed Alpha')

  // layout.chat-row.rename-input-guard: clicking into the field must not
  // fall through to the row and switch the open conversation. Row 0 is the
  // empty chat, so the exchange staying off screen is the proof.
  await chatRows(page).nth(0).click()
  await expect(page.getByText(DEFAULT_ASSISTANT_REPLY)).toHaveCount(0)
  await chatRows(page).nth(1).hover()
  await chatRows(page).nth(1).getByTestId('layout.rename-chat.click').click()
  await page.getByTestId('layout.chat-row.rename-input-guard').click()
  await expect(page.getByText(DEFAULT_ASSISTANT_REPLY)).toHaveCount(0)
  await expect(page.getByTestId('layout.chat-row.rename-input-guard')).toBeFocused()

  // layout.chat-row.cancel-rename: the typed title is thrown away.
  await page.getByTestId('layout.chat-row.rename-input-guard').fill('Discarded Beta')
  await page.getByTestId('layout.chat-row.cancel-rename').click()
  await expect(page.getByTestId('layout.chat-row.rename-input-guard')).toHaveCount(0)
  await expect(chatRows(page).nth(1)).toContainText('Renamed Alpha')
  await expect(page.getByText('Discarded Beta')).toHaveCount(0)

  // layout.delete-chat.click: the hover bin drops the row without asking.
  await chatRows(page).nth(0).hover()
  await chatRows(page).nth(0).getByTestId('layout.delete-chat.click').click()
  await expect(chatRows(page)).toHaveCount(1)
  await expect(chatRows(page).nth(0)).toContainText('Renamed Alpha')
})

test('the right-click menu renames, deletes, and closes only outside itself', async ({ page }) => {
  await bootLayout(page)
  await newChatRow(page)
  await newChatRow(page)
  await expect(chatRows(page)).toHaveCount(2)

  // layout.chat-row-menu.keep-open: a click on the menu body is swallowed;
  // the overlay handler must not see it.
  await openRowMenu(page, 0)
  await page.getByTestId('layout.chat-row-menu.keep-open').click({ position: { x: 4, y: 1 } })
  await expect(page.getByTestId('layout.chat-row-menu.keep-open')).toBeVisible()

  // layout.chat-row-menu.close-overlay: a click beside the menu closes it,
  // and nothing else happens: both rows survive.
  await page.getByTestId('layout.chat-row-menu.close-overlay').click({ position: { x: 5, y: 5 } })
  await expect(page.getByTestId('layout.chat-row-menu.keep-open')).toHaveCount(0)
  await expect(chatRows(page)).toHaveCount(2)

  // layout.chat-row-menu.rename: closes the menu and hands over the row's
  // own title in an editable field.
  await openRowMenu(page, 0)
  await page.getByTestId('layout.chat-row-menu.rename').click()
  await expect(page.getByTestId('layout.chat-row-menu.keep-open')).toHaveCount(0)
  await expect(page.getByTestId('layout.chat-row.rename-input-guard')).toHaveValue('New Chat')
  await page.getByTestId('layout.chat-row.rename-input-guard').fill('Menu Renamed')
  await page.getByTestId('layout.chat-row.confirm-rename').click()
  await expect(chatRows(page).nth(0)).toContainText('Menu Renamed')

  // layout.chat-row-menu.delete: the row is gone and the menu with it.
  await openRowMenu(page, 0)
  await page.getByTestId('layout.chat-row-menu.delete').click()
  await expect(page.getByTestId('layout.chat-row-menu.keep-open')).toHaveCount(0)
  await expect(chatRows(page)).toHaveCount(1)
  await expect(page.getByText('Menu Renamed')).toHaveCount(0)
})

test('the mode tabs swap which conversations the list shows', async ({ page }) => {
  await bootLayout(page)
  await newChatRow(page)
  await page.getByTestId('layout.chat-row.open').nth(0).hover()
  await page.getByTestId('layout.rename-chat.click').first().click()
  await page.getByTestId('layout.chat-row.rename-input-guard').fill('Plain Chat')
  await page.getByTestId('layout.chat-row.confirm-rename').click()
  await expect(chatRows(page).nth(0)).toContainText('Plain Chat')

  // layout.code.click: Code mode owns a separate list: the chat above is
  // gone from view and New Chat here produces a "Coding Agent" row.
  await page.getByTestId('layout.code.click').click()
  await expect(page.getByText('Plain Chat')).toHaveCount(0)
  await expect(page.getByText('No conversations')).toBeVisible()
  await newChatRow(page)
  await expect(chatRows(page).nth(0)).toContainText('Coding Agent')

  // layout.chat.click: back to the chat list, and the coding row is the one
  // that disappears now.
  await page.getByTestId('layout.chat.click').click()
  await expect(page.getByText('Coding Agent')).toHaveCount(0)
  await expect(chatRows(page)).toHaveCount(1)
  await expect(chatRows(page).nth(0)).toContainText('Plain Chat')
})
