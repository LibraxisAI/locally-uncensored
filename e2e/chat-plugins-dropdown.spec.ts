import { test, expect } from '@playwright/test'
import {
  bootChat,
  main,
  persistedLocal,
  persistedConversations,
  seedSecondModel,
  SECOND_MODEL,
} from './support/journeys/chat'

/**
 * QA journey: the Plugins dropdown in the composer, every section of it.
 *
 * The panel holds four independent features that all write somewhere else:
 * Chat Tools and Caveman live in the global settings, the persona switch is
 * global but its on/off is per conversation, and the group line-up belongs to
 * the conversation alone. So every step here reads the value back out of the
 * store that actually owns it, not out of the row that was clicked.
 */

interface SettingsState {
  settings: { chatToolsEnabled?: boolean; cavemanMode?: string }
  activePersonaId?: string
}

const settings = (page: import('@playwright/test').Page) =>
  persistedLocal<SettingsState>(page, 'chat-settings')

test('the Plugins panel drives tools, caveman, personas and the group line-up', async ({ page }) => {
  await seedSecondModel(page)
  await bootChat(page, { ollamaModels: [SECOND_MODEL] })

  const trigger = main(page).getByTestId('chat.plugins-menu.toggle')
  await expect(trigger).toBeVisible({ timeout: 20_000 })

  // ── open ────────────────────────────────────────────────────────────
  await trigger.click()
  const chatTools = page.getByTestId('chat.chat-tools.toggle')
  await expect(chatTools).toBeVisible({ timeout: 10_000 })

  // ── Chat Tools ──────────────────────────────────────────────────────
  const toolsBefore = (await settings(page))?.settings.chatToolsEnabled !== false
  await chatTools.click()
  await expect
    .poll(async () => (await settings(page))?.settings.chatToolsEnabled !== false)
    .toBe(!toolsBefore)
  // Round trip, so the row is a switch and not a one-way write.
  await chatTools.click()
  await expect
    .poll(async () => (await settings(page))?.settings.chatToolsEnabled !== false)
    .toBe(toolsBefore)

  // ── Caveman Mode ────────────────────────────────────────────────────
  // Collapsed at first: no mode rows exist until the section is opened.
  await expect(page.getByTestId('chat.caveman-mode.select')).toHaveCount(0)
  await page.getByTestId('chat.caveman-modes.toggle').click()
  await expect(page.getByTestId('chat.caveman-mode.select')).toHaveCount(4)

  await page.getByTestId('chat.caveman-mode.select').filter({ hasText: 'Ultra' }).click()
  // The pick lands in the settings AND folds the section back up.
  await expect.poll(async () => (await settings(page))?.settings.cavemanMode).toBe('ultra')
  await expect(page.getByTestId('chat.caveman-mode.select')).toHaveCount(0)
  // The section header now reads the chosen mode back.
  await expect(page.getByTestId('chat.caveman-modes.toggle')).toContainText('Ultra')

  // ── Personas ────────────────────────────────────────────────────────
  await expect(page.getByTestId('chat.persona.select')).toHaveCount(0)
  await page.getByTestId('chat.persona-list.toggle').click()
  const personaRows = page.getByTestId('chat.persona.select')
  await expect(personaRows.first()).toBeVisible()
  const personaCount = await personaRows.count()
  expect(personaCount).toBeGreaterThan(1)

  // Pick a persona that is NOT the default, so the change is visible.
  const chosen = (await personaRows.nth(1).innerText()).trim()
  await personaRows.nth(1).click()
  await expect(page.getByTestId('chat.persona.select')).toHaveCount(0)
  await expect(page.getByTestId('chat.persona-list.toggle')).toContainText(chosen)
  await expect.poll(async () => (await settings(page))?.activePersonaId).not.toBe('unrestricted')

  // The per-chat switch is a different lever: it writes to the conversation,
  // which is why every chat can run the same persona differently.
  const perChat = page.getByTestId('chat.persona-for-chat.toggle')
  await expect(perChat).toHaveAttribute('title', /Enable persona for this chat/i)
  await perChat.click()
  await expect(perChat).toHaveAttribute('title', /Disable persona for this chat/i)
  await expect.poll(async () => (await persistedConversations(page))[0]?.personaEnabled, { timeout: 30_000 }).toBe(true)

  // ── Group chat ──────────────────────────────────────────────────────
  await expect(page.getByTestId('chat.group-chat-model.toggle')).toHaveCount(0)
  await page.getByTestId('chat.group-chat.toggle').click()
  const modelRows = page.getByTestId('chat.group-chat-model.toggle')
  await expect(modelRows).toHaveCount(2, { timeout: 10_000 })

  // One model is not a group yet, and the panel says so.
  await modelRows.nth(0).click()
  await expect(page.getByText('One more model turns this into a group.')).toBeVisible()
  await modelRows.nth(1).click()
  // Two models: the header counts them and the conversation carries them.
  await expect(page.getByTestId('chat.group-chat.toggle')).toContainText('2 models')
  await expect
    .poll(async () => (await persistedConversations(page))[0]?.groupModels?.length, { timeout: 30_000 })
    .toBe(2)

  // Turn off empties the line-up on the conversation, not just the display.
  await page.getByTestId('chat.group-chat.clear').click()
  await expect(page.getByTestId('chat.group-chat.toggle')).toContainText('Off')
  await expect
    .poll(async () => (await persistedConversations(page))[0]?.groupModels?.length, { timeout: 30_000 })
    .toBe(0)

  // ── dismiss ─────────────────────────────────────────────────────────
  // The click-away layer closes the whole panel, not just the open section.
  await page.getByTestId('chat.plugins-menu.dismiss').click({ position: { x: 5, y: 5 } })
  await expect(page.getByTestId('chat.chat-tools.toggle')).toHaveCount(0)
  await expect(page.getByTestId('chat.group-chat.toggle')).toHaveCount(0)

  // The settings the panel wrote outlive it: the trigger keeps the active
  // markers for caveman and persona while the panel is shut.
  await expect.poll(async () => (await settings(page))?.settings.cavemanMode).toBe('ultra')

  // And the trigger opens it again from scratch. (Closing it is the click-away
  // layer's job by design: while the panel is open that layer covers the whole
  // viewport, the trigger included.)
  await trigger.click()
  await expect(page.getByTestId('chat.chat-tools.toggle')).toBeVisible()
})
