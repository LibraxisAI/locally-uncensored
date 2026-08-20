import { test, expect } from '@playwright/test'
import { bootChat, send, main, bucket, persistedLocal, persistedIdb, REPLY } from './support/journeys/chat'

/**
 * QA journey: the slim top bar over the transcript.
 *
 * A user finishes a turn, saves the conversation to disk, retunes the context
 * window the model runs with, and keeps a standing memory. Three unrelated
 * surfaces, one row of controls, so they share a spec but not a test.
 */

interface SettingsState {
  settings: { builtinEngine?: { ctx?: number } }
}

interface MemoryState {
  entries: Array<{ title: string; content: string }>
}

test('Export writes the conversation through the native Save dialog', async ({ page }) => {
  await bootChat(page)
  await send(page, 'EXPORT-ME-PLEASE')

  const exportBtn = main(page).getByTestId('chat.export-chat.click')
  await exportBtn.click()
  const formats = main(page).getByTestId('chat.export-format.select')
  await expect(formats).toHaveCount(2)

  // Clicking away closes the menu and writes nothing.
  await main(page).getByTestId('chat.export-menu.dismiss').click({ position: { x: 5, y: 5 } })
  await expect(main(page).getByTestId('chat.export-format.select')).toHaveCount(0)
  expect(await bucket(page, '__E2E_DIALOG_CALLS__')).toEqual([])

  // Now really export as markdown.
  await exportBtn.click()
  await main(page).getByTestId('chat.export-format.select').filter({ hasText: '.md' }).click()

  // The bridge was asked to save a real file, and the payload is the chat:
  // both the question and the answer are inside the bytes that went out.
  await expect
    .poll(async () => (await bucket(page, '__E2E_DIALOG_CALLS__')).length, { timeout: 10_000 })
    .toBe(1)
  const [call] = await bucket(page, '__E2E_DIALOG_CALLS__')
  expect(call.cmd).toBe('save_text_file_dialog')
  expect(call.extension).toBe('md')
  expect(Number(call.bytes)).toBeGreaterThan(REPLY.length)
  // And the path the dialog returned is reported back to the user.
  await expect(page.getByText(/Saved to \/tmp\/lu-e2e\/saved\//)).toBeVisible({ timeout: 10_000 })
  // The menu closed itself on pick, so a second export needs a second open.
  await expect(main(page).getByTestId('chat.export-format.select')).toHaveCount(0)
})

test('the context dropdown retunes the engine the next start uses', async ({ page }) => {
  await bootChat(page)
  const trigger = main(page).getByTestId('chat.context-window.toggle')
  await expect(trigger).toBeVisible({ timeout: 20_000 })

  // ── open / dismiss ──────────────────────────────────────────────────
  await trigger.click()
  await expect(main(page).getByTestId('chat.context-window.preset').first()).toBeVisible()
  await main(page).getByTestId('chat.context-window.dismiss').click({ position: { x: 5, y: 5 } })
  await expect(main(page).getByTestId('chat.context-window.preset')).toHaveCount(0)

  const ctxOf = async () =>
    (await persistedLocal<SettingsState>(page, 'chat-settings'))?.settings.builtinEngine?.ctx

  const before = await ctxOf()
  expect(before).not.toBe(0)
  expect(before).not.toBe(16384)

  // ── Auto ────────────────────────────────────────────────────────────
  await trigger.click()
  await main(page).getByTestId('chat.context-window.auto').click()
  // Auto is stored as 0, which is what makes the engine choose for itself on
  // its next start. The picker closing itself is the other half of the click.
  await expect.poll(ctxOf, { timeout: 10_000 }).toBe(0)
  await expect(main(page).getByTestId('chat.context-window.auto')).toHaveCount(0)

  // ── a preset ────────────────────────────────────────────────────────
  await trigger.click()
  await main(page).getByTestId('chat.context-window.preset').filter({ hasText: '16K' }).click()
  // The built-in engine keeps its ctx in the expert tuning, and that is what
  // the next start passes as -c.
  await expect.poll(ctxOf, { timeout: 10_000 }).toBe(16384)
  await expect(main(page).getByTestId('chat.context-window.preset')).toHaveCount(0)

  // Reopening shows the choice as the selected row, so the check mark reads
  // the same value the store holds.
  await trigger.click()
  const sixteen = main(page).getByTestId('chat.context-window.preset').filter({ hasText: '16K' })
  await expect(sixteen.locator('svg')).toHaveCount(1)
})

test('Memory adds, keeps and deletes a standing instruction', async ({ page }) => {
  await bootChat(page)
  const brain = main(page).getByTestId('chat.memory-view-add-or-delete-the-context-injected-i.click')
  await expect(brain).toBeVisible({ timeout: 20_000 })

  // ── open ────────────────────────────────────────────────────────────
  await brain.click()
  const add = page.getByTestId('chat.add-a-memory.click')
  await expect(add).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('No memories yet,')).toBeVisible()

  // ── the add form opens and can be abandoned ─────────────────────────
  await add.click()
  const save = page.getByTestId('chat.memory-add-form.save')
  await expect(save).toBeVisible()
  await page.getByPlaceholder('Title (optional)').fill('THROWAWAY')
  await page.getByTestId('chat.memory-add-form.cancel').click()
  await expect(page.getByTestId('chat.memory-add-form.save')).toHaveCount(0)
  // Cancel discarded the draft: nothing was remembered.
  await expect(page.getByText('No memories yet,')).toBeVisible()

  // ── write one for real ──────────────────────────────────────────────
  await add.click()
  await page.getByPlaceholder('Title (optional)').fill('CALL-ME-CAPTAIN')
  await page
    .getByPlaceholder(/What should the model always remember/)
    .fill('Always address the user as Captain.')
  await page.getByTestId('chat.memory-add-form.save').click()

  // Saved: the form closed, the row is in the list, the store holds it, and
  // the brain badge counts it.
  await expect(page.getByTestId('chat.memory-add-form.save')).toHaveCount(0)
  await expect(page.getByText('CALL-ME-CAPTAIN', { exact: true })).toBeVisible()
  await expect
    .poll(async () => (await persistedIdb<MemoryState>(page, 'locally-uncensored-memory'))?.entries.length)
    .toBe(1)
  await expect(page.getByText('Memory (1)')).toBeVisible()
  // Strongest proof there is for this panel: the memory shows up in the
  // "Injected into prompt" block, i.e. it really reaches the model.
  await expect(page.getByText(/<remembered_context>/)).toContainText('CALL-ME-CAPTAIN')

  // ── the panel body swallows clicks so the overlay cannot close it ────
  await page.getByTestId('chat.memory-panel.keep-open').click({ position: { x: 200, y: 12 } })
  await expect(page.getByTestId('chat.add-a-memory.click')).toBeVisible()

  // ── the overlay outside the panel does close it ─────────────────────
  await page.getByTestId('chat.memory-overlay.close').click({ position: { x: 5, y: 5 } })
  await expect(page.getByTestId('chat.add-a-memory.click')).toHaveCount(0)
  // The badge on the button survives, because the memory did.
  await expect(brain).toContainText('1')

  // ── delete it again ─────────────────────────────────────────────────
  await brain.click()
  await expect(page.getByText('CALL-ME-CAPTAIN', { exact: true })).toBeVisible()
  await page.getByTestId('chat.delete-this-memory.click').click()
  await expect(page.getByText('CALL-ME-CAPTAIN', { exact: true })).toHaveCount(0)
  // Gone from the injection too, not just from the list.
  await expect(page.getByText(/<remembered_context>/)).toHaveCount(0)
  await expect(page.getByText('No memories yet,')).toBeVisible()
  await expect
    .poll(async () => (await persistedIdb<MemoryState>(page, 'locally-uncensored-memory'))?.entries.length)
    .toBe(0)

  // ── and the X closes the panel ──────────────────────────────────────
  await page.getByTestId('chat.memory-panel.close').click()
  await expect(page.getByTestId('chat.add-a-memory.click')).toHaveCount(0)
})
