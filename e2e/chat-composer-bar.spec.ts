import { test, expect } from '@playwright/test'
import { bootChat, send, instruct, main, inChat, composer, persistedLocal, persistedConversations, REPLY } from './support/journeys/chat'

/**
 * QA journey: the composer action bar, left to right.
 *
 * A user attaches a screenshot, changes their mind about it, flips Thinking,
 * opens the Documents panel and arms it, and finally stops a long answer
 * halfway through. Each control is judged by the state it leaves behind:
 * a preview that exists or does not, a persisted setting, a panel that is
 * mounted, an answer that stopped growing.
 */

// Smallest valid PNG: 1x1, transparent.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

interface SettingsState { settings: { thinkingEnabled?: boolean } }

test('the clip attaches an image, the cross takes it back', async ({ page }) => {
  await bootChat(page)
  await expect(composer(page)).toBeVisible({ timeout: 20_000 })

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    main(page).getByTestId('chat.composer-attach.click').click(),
  ])
  await chooser.setFiles([
    { name: 'screenshot.png', mimeType: 'image/png', buffer: PNG },
    { name: 'diagram.png', mimeType: 'image/png', buffer: PNG },
  ])

  // The clip opened the picker AND both chosen files were read into the
  // composer: a preview thumbnail now carries each file name.
  await expect(main(page).getByAltText('screenshot.png')).toBeVisible({ timeout: 10_000 })
  await expect(main(page).getByAltText('diagram.png')).toBeVisible()

  // The cross removes the one it sits on, not simply the last one added.
  await main(page).getByTestId('chat.composer-image.remove').nth(0).click()
  await expect(main(page).getByAltText('screenshot.png')).toHaveCount(0)
  await expect(main(page).getByAltText('diagram.png')).toBeVisible()

  // What survives the cross is what the turn actually carries: one image, the
  // kept one, all the way into the stored message.
  await send(page, 'LOOK-AT-THIS')
  const conv = (await persistedConversations(page))[0] as unknown as {
    messages: Array<{ role: string; images?: Array<{ name: string }> }>
  }
  const sent = conv.messages.find((m) => m.role === 'user')
  expect(sent?.images?.map((i) => i.name)).toEqual(['diagram.png'])
})

test('Think flips the persisted setting and says so', async ({ page }) => {
  await bootChat(page)
  const think = main(page).getByTestId('chat.composer-think.toggle')
  await expect(think).toBeVisible({ timeout: 20_000 })

  const before = (await persistedLocal<SettingsState>(page, 'chat-settings'))?.settings.thinkingEnabled
  await think.click()
  // The title is the switch's own read-out, and the setting behind it really
  // moved. Both halves matter, because a model that cannot think renders the
  // same button inert.
  await expect(think).toHaveAttribute('title', before ? /Thinking OFF/ : /Thinking ON/)
  await expect
    .poll(async () => (await persistedLocal<SettingsState>(page, 'chat-settings'))?.settings.thinkingEnabled)
    .toBe(!before)

  await think.click()
  await expect(think).toHaveAttribute('title', before ? /Thinking ON/ : /Thinking OFF/)
  await expect
    .poll(async () => (await persistedLocal<SettingsState>(page, 'chat-settings'))?.settings.thinkingEnabled)
    .toBe(before)
})

test('Docs opens the panel, arms retrieval, and the chevron folds it away', async ({ page }) => {
  await bootChat(page)
  const docs = main(page).getByTestId('chat.docs-panel.toggle')
  await expect(docs).toBeVisible({ timeout: 20_000 })

  await docs.click()
  // The panel really mounted: its own header controls exist now.
  const ragToggle = page.getByTestId('chat.rag-enabled.toggle')
  await expect(ragToggle).toBeVisible({ timeout: 10_000 })
  await expect(ragToggle).toHaveAttribute('aria-label', 'Enable RAG')

  await ragToggle.click()
  // Retrieval is armed for THIS conversation, which the button and the Docs
  // chip both read back out of the store.
  await expect(ragToggle).toHaveAttribute('aria-label', 'Disable RAG')

  await page.getByTestId('chat.collapse-panel.click-2').click()
  await expect(page.getByTestId('chat.rag-enabled.toggle')).toHaveCount(0, { timeout: 10_000 })

  // And the toggle is a real close/open pair, not a one-way door.
  await docs.click()
  await expect(page.getByTestId('chat.rag-enabled.toggle')).toBeVisible({ timeout: 10_000 })
  // The armed state survived the fold, so the toggle wrote to the store and
  // not to the panel's local state.
  await expect(page.getByTestId('chat.rag-enabled.toggle')).toHaveAttribute('aria-label', 'Disable RAG')
})

test('Stop cuts a streaming answer off where it stands', async ({ page }) => {
  // Slow enough that a human could actually reach for the button.
  await bootChat(page, { replyChunks: 80, replyChunkDelayMs: 120 })

  // `instruct` sends and confirms the QUESTION is in the transcript, retrying
  // if it is not. ChatInput clears the box before the hook decides whether to
  // accept the turn, so a send dropped while boot is still settling leaves no
  // trace at all and the run under test would never exist.
  await instruct(page, 'WRITE-SOMETHING-LONG')

  const stop = main(page).getByTestId('chat.stop-generation.click')
  await expect(stop).toBeVisible({ timeout: 20_000 })
  // Let a few frames of the answer land, then cut it off mid-sentence.
  await expect(inChat(page, /ANSWER_MARKER/)).toBeVisible({ timeout: 20_000 })
  await stop.click()

  // Send is back, so the run really ended rather than merely being asked to.
  await expect(main(page).getByTestId('chat.send-message.click')).toBeVisible({ timeout: 15_000 })
  // The answer froze: whatever had arrived stays, the rest never does.
  const frozen = await inChat(page, /ANSWER_MARKER/).first().innerText()
  await page.waitForTimeout(2500)
  expect(await inChat(page, /ANSWER_MARKER/).first().innerText()).toBe(frozen)
  expect(frozen.length).toBeLessThan(REPLY.length)
})
