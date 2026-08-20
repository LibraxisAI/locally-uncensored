import { test, expect } from '@playwright/test'
import { bootChat, send, main, inChat, composer, persistedConversations, REPLY } from './support/journeys/chat'

/**
 * QA journey: everything the action bar under a message can do.
 *
 * One user writes two turns and then works the thread over the way a real
 * person does: copy a line out, start an edit and think better of it, rewrite
 * what the model said, throw that rewrite away with a regenerate, re-ask a
 * question with different wording, and finally delete a line.
 *
 * Each step is judged by what changed afterwards, never by the button being
 * on screen: the clipboard really holds the text, the transcript really lost
 * the turn, the persisted store really carries the new wording.
 */

const FIRST = 'ALPHA-PROMPT'
const SECOND = 'BRAVO-PROMPT'
const REWRITE = 'CHARLIE-HANDWRITTEN-ANSWER'
const REASKED = 'DELTA-REASKED-PROMPT'

test('the message action bar copies, edits, regenerates and deletes a turn', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await bootChat(page)

  // ── send ────────────────────────────────────────────────────────────
  await send(page, FIRST)
  await expect(inChat(page, REPLY)).toHaveCount(1)
  await send(page, SECOND)
  await expect(inChat(page, REPLY)).toHaveCount(2)

  // ── copy ────────────────────────────────────────────────────────────
  // Bubble 0 is the first user message; the copy button writes ITS text, not
  // the answer's, so the clipboard is the only honest witness here.
  await main(page).getByTestId('chat.copy-message.click').nth(0).click()
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 10_000 })
    .toBe(FIRST)

  // ── edit a question, then change your mind ──────────────────────────
  await main(page).getByTestId('chat.edit-message.click').nth(0).click()
  // The inline editor mounts INSIDE the list, above the composer, so it is the
  // first textarea on the surface while an edit is open.
  const editBox = main(page).locator('textarea').first()
  await expect(editBox).toHaveValue(FIRST)
  await editBox.fill('THIS-MUST-NEVER-LAND')
  await main(page).getByTestId('chat.message-edit.cancel').click()
  // Cancel drops the draft on the floor: no editor left, original text intact,
  // and the abandoned wording nowhere in the thread.
  await expect(main(page).getByTestId('chat.message-edit.cancel')).toHaveCount(0)
  await expect(inChat(page, FIRST)).toBeVisible()
  await expect(inChat(page, 'THIS-MUST-NEVER-LAND')).toHaveCount(0)

  // ── rewrite what the model said ─────────────────────────────────────
  // The pencil on an answer only appears once that turn is finished, which is
  // why this targets the FIRST answer while a second turn sits below it.
  await main(page).getByTestId('chat.edit-response.click').nth(0).click()
  await expect(main(page).locator('textarea').first()).toHaveValue(REPLY)
  await main(page).locator('textarea').first().fill(REWRITE)
  await main(page).getByTestId('chat.message-edit.confirm').click()
  // History is rewritten in place: no resend, one answer replaced.
  await expect(inChat(page, REWRITE)).toBeVisible()
  await expect(inChat(page, REPLY)).toHaveCount(1)
  const afterRewrite = await persistedConversations(page)
  expect(afterRewrite[0].messages.map((m) => m.content)).toContain(REWRITE)

  // ── regenerate ──────────────────────────────────────────────────────
  // Regenerating the first answer replays its question, so the hand-written
  // text AND everything after it leave the thread.
  await main(page).getByTestId('chat.regenerate-response.click').nth(0).click()
  await expect(inChat(page, REWRITE)).toHaveCount(0, { timeout: 30_000 })
  await expect(inChat(page, SECOND)).toHaveCount(0)
  await expect(inChat(page, REPLY)).toHaveCount(1, { timeout: 30_000 })
  await expect(inChat(page, FIRST)).toBeVisible()

  // ── edit a question for real ────────────────────────────────────────
  await expect(main(page).getByTestId('chat.edit-message.click')).toHaveCount(1, { timeout: 30_000 })
  await main(page).getByTestId('chat.edit-message.click').nth(0).click()
  await main(page).locator('textarea').first().fill(REASKED)
  await main(page).getByTestId('chat.message-edit.confirm').click()
  // Confirm on a QUESTION re-asks it: the old wording is gone, the new one is
  // in the thread, and an answer came back for it.
  await expect(inChat(page, REASKED)).toBeVisible({ timeout: 30_000 })
  await expect(inChat(page, FIRST)).toHaveCount(0)
  await expect(inChat(page, REPLY)).toHaveCount(1, { timeout: 30_000 })
  const afterEdit = await persistedConversations(page)
  expect(afterEdit[0].messages.filter((m) => m.role === 'user').map((m) => m.content)).toEqual([REASKED])

  // ── delete, in two steps ────────────────────────────────────────────
  await expect(composer(page)).toBeVisible()
  const del = main(page).getByTestId('chat.delete-message.click')
  const answerDelete = del.nth(1)
  // First click only arms it. The title is the armed state made visible, and
  // nothing has left the thread yet.
  await answerDelete.click()
  await expect(answerDelete).toHaveAttribute('title', /Click again to delete/i)
  await expect(inChat(page, REPLY)).toHaveCount(1)
  // Second click inside the 3 s window removes exactly that one line.
  await answerDelete.click()
  await expect(inChat(page, REPLY)).toHaveCount(0)
  await expect(inChat(page, REASKED)).toBeVisible()
  const afterDelete = await persistedConversations(page)
  expect(afterDelete[0].messages.map((m) => m.role)).toEqual(['user'])
})
