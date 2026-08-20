import { test, expect } from '@playwright/test'
import { bootChat, send, main, bucket } from './support/journeys/chat'

/**
 * QA journey: an answer that is more than prose.
 *
 * The model reasons first, then writes a long code block, links out to a page
 * and embeds a picture from a host nobody vetted. Every one of those pieces
 * has its own control, and each control has to do something: reveal the
 * reasoning, copy real source, unfold the hidden lines, and hand a URL to the
 * system browser instead of fetching it silently.
 */

const CODE_LINES = [
  'const one = 1',
  'const two = 2',
  'const three = 3',
  'const four = 4',
  'const five = 5',
  'const six = 6',
]

const ANSWER = [
  '<think>REASONING-BEHIND-THE-ANSWER</think>',
  'Here is the plan. See [the handbook](https://example.com/handbook) for context,',
  'and the sketch ![blueprint](https://untrusted.example.com/sketch.png).',
  '',
  '```ts',
  ...CODE_LINES,
  '```',
].join('\n')

test('a rich answer reveals its reasoning, copies its code and opens links outside', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await bootChat(page, { assistantReply: ANSWER })
  await send(page, 'EXPLAIN-WITH-CODE')

  // ── thinking ────────────────────────────────────────────────────────
  const think = main(page).getByTestId('chat.toggle-thinking-details.click')
  await expect(think).toBeVisible({ timeout: 20_000 })
  // Folded by default: the reasoning is not in the transcript until asked for.
  await expect(main(page).getByText('REASONING-BEHIND-THE-ANSWER')).toHaveCount(0)
  await think.click()
  await expect(main(page).getByText('REASONING-BEHIND-THE-ANSWER')).toBeVisible()
  await think.click()
  await expect(main(page).getByText('REASONING-BEHIND-THE-ANSWER')).toHaveCount(0)

  // ── the code block starts collapsed ─────────────────────────────────
  const expand = main(page).getByTestId('chat.code-block.expand')
  await expect(expand).toContainText(`Show all ${CODE_LINES.length} lines`)
  await expect(main(page).getByText('const one = 1')).toBeVisible()
  await expect(main(page).getByText('const six = 6')).toHaveCount(0)

  await expand.click()
  // Unfolded: the tail of the block is really rendered now, and the button
  // offers the way back.
  await expect(main(page).getByText('const six = 6')).toBeVisible()
  await expect(expand).toContainText('Collapse')
  await expand.click()
  await expect(main(page).getByText('const six = 6')).toHaveCount(0)

  // ── copy the code ───────────────────────────────────────────────────
  // Collapsed on screen, but Copy takes the WHOLE block, not the visible
  // four lines, which is the only version of this button worth having.
  await main(page).getByTestId('chat.copy-code.click').click()
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 10_000 })
    .toBe(CODE_LINES.join('\n'))

  // ── links and untrusted images go to the system browser ─────────────
  expect(await bucket(page, '__E2E_OPENED_URLS__')).toEqual([])
  await main(page).getByTestId('chat.markdown-link.open-external').click()
  await expect
    .poll(async () => page.evaluate(() => (window as unknown as { __E2E_OPENED_URLS__?: string[] }).__E2E_OPENED_URLS__ ?? []))
    .toEqual(['https://example.com/handbook'])

  // The picture is from a host nobody vetted, so it is a click-to-open link
  // rather than a silent GET, and clicking it hands the URL out the same way.
  await main(page).getByTestId('chat.markdown-image.open-external').click()
  await expect
    .poll(async () => page.evaluate(() => (window as unknown as { __E2E_OPENED_URLS__?: string[] }).__E2E_OPENED_URLS__ ?? []))
    .toEqual(['https://example.com/handbook', 'https://untrusted.example.com/sketch.png'])
})
