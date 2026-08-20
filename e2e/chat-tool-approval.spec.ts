import { test, expect, type Page } from '@playwright/test'
import { bootChat, main, bucket, instruct, enableAgentMode, persistedLocal } from './support/journeys/chat'

/**
 * QA journey: deciding on a tool the agent wants to run.
 *
 * A paused run is the one moment where the app hands control back, so both
 * places that offer the decision have to work: the strip above the composer
 * (which exists because a run once sat waiting seven minutes below the fold)
 * and the buttons inside the tool block itself. Approve has to actually reach
 * the bridge; Reject has to make sure it never does.
 *
 * One run per test on purpose. The mock walks its scripted turns with a single
 * counter per page, and EVERY model call the app makes takes the next entry,
 * including the background ones a finished run kicks off (memory extraction).
 * A second run in the same page would therefore read a turn that a background
 * call had already eaten, and it would do so only sometimes.
 */

const COMMAND = 'echo decide-me'

async function bootAgentRun(page: Page, closingLine: string): Promise<void> {
  await bootChat(page, {
    agentTurns: [
      { text: 'about to run it', toolCalls: [{ name: 'shell_execute', args: { command: COMMAND } }] },
      { text: closingLine },
    ],
  })
  await enableAgentMode(page)
  await instruct(page, 'run the command')
}

const shellRuns = async (page: Page) =>
  (await bucket(page, '__E2E_TOOL_CALLS__')).filter((c) => c.cmd === 'shell_execute')

test('the strip shows the arguments on demand and Reject keeps the command off the bridge', async ({ page }) => {
  await bootAgentRun(page, 'REJECTED-RUN-DONE')

  const args = main(page).getByTestId('chat.approval-args.toggle')
  await expect(args).toBeVisible({ timeout: 30_000 })
  // The strip folds its arguments away. The pending block below already
  // prints them once, so the chevron is proved by a SECOND copy appearing
  // and disappearing with it.
  const printed = main(page).getByText(new RegExp(COMMAND))
  await expect(printed).toHaveCount(1)
  await args.click()
  await expect(printed).toHaveCount(2)
  await args.click()
  await expect(printed).toHaveCount(1)

  await main(page).getByTestId('chat.approval.reject').click()
  // Refused means refused: the command never reached the bridge, and the run
  // carried on to its closing turn instead of hanging.
  await expect(main(page).getByText('REJECTED-RUN-DONE')).toBeVisible({ timeout: 30_000 })
  expect(await shellRuns(page)).toEqual([])
})

test('Approve on the strip is what puts the command on the bridge', async ({ page }) => {
  await bootAgentRun(page, 'APPROVED-RUN-DONE')

  const approve = main(page).getByTestId('chat.approval.approve')
  await expect(approve).toBeVisible({ timeout: 30_000 })
  // Nothing has run while the decision is open.
  expect(await shellRuns(page)).toEqual([])

  await approve.click()
  await expect(main(page).getByText('APPROVED-RUN-DONE')).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => (await shellRuns(page)).map((c) => c.command)).toEqual([COMMAND])
})

test('the buttons inside the block decide the same run, and the header folds it', async ({ page }) => {
  await bootAgentRun(page, 'BLOCK-APPROVED-DONE')

  const blockApprove = main(page).getByTestId('chat.tool-call.approve')
  await expect(blockApprove).toBeVisible({ timeout: 30_000 })
  // A block awaiting a decision opens itself, so the arguments are readable
  // without a click, and the header can fold them away again.
  const printed = main(page).getByText(new RegExp(COMMAND))
  const toggle = main(page).getByTestId('chat.tool-call.toggle')
  await expect(printed).toHaveCount(1)
  await toggle.click()
  await expect(printed).toHaveCount(0)
  await toggle.click()
  await expect(printed).toHaveCount(1)

  await blockApprove.click()
  await expect(main(page).getByText('BLOCK-APPROVED-DONE')).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => (await shellRuns(page)).map((c) => c.command)).toEqual([COMMAND])
})

test('Reject inside the block stops the command just as the strip does', async ({ page }) => {
  await bootAgentRun(page, 'BLOCK-REJECTED-DONE')

  const blockReject = main(page).getByTestId('chat.tool-call.reject')
  await expect(blockReject).toBeVisible({ timeout: 30_000 })
  await blockReject.click()
  await expect(main(page).getByText('BLOCK-REJECTED-DONE')).toBeVisible({ timeout: 30_000 })
  expect(await shellRuns(page)).toEqual([])
})

test('consecutive tool calls collapse into one band that opens on demand', async ({ page }) => {
  // Nothing to approve here: this run is about the transcript, so the file
  // category is pre-approved the way a user who trusts it would leave it.
  // Seeded BEFORE the boot: a reload afterwards would race the coalesced
  // write of the open conversation and land on an empty chat.
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'locally-uncensored-permissions',
      JSON.stringify({
        state: {
          globalPermissions: {
            filesystem: 'auto', terminal: 'auto', desktop: 'auto', web: 'auto',
            system: 'auto', image: 'auto', video: 'auto', workflow: 'auto',
          },
          conversationOverrides: {}, perToolOverrides: {}, modeScope: 'agent',
        },
        version: 2,
      }),
    )
  })
  await bootChat(page, {
    agentTurns: [
      {
        text: 'reading both',
        toolCalls: [
          { name: 'file_read', args: { path: 'src/alpha.ts' } },
          { name: 'file_read', args: { path: 'src/bravo.ts' } },
        ],
      },
      { text: 'BAND-RUN-DONE' },
    ],
    files: { 'alpha.ts': 'ALPHA-FILE-BODY', 'bravo.ts': 'BRAVO-FILE-BODY' },
  })
  await enableAgentMode(page)

  await instruct(page, 'read both files')
  await expect(main(page).getByText('BAND-RUN-DONE')).toBeVisible({ timeout: 30_000 })

  // Two calls, one row: collapsed, the transcript shows a count instead of a
  // chip per call, and neither path is on screen.
  const band = main(page).getByTestId('chat.tool-call-band.toggle')
  await expect(band).toContainText('2 steps')
  await expect(main(page).getByText('src/bravo.ts')).toHaveCount(0)

  await band.click()
  // Expanded, every call is back with its own block, and each block still
  // opens to its own arguments.
  const blocks = main(page).getByTestId('chat.tool-call.toggle')
  await expect(blocks).toHaveCount(2)
  await blocks.nth(0).click()
  await expect(main(page).getByText(/src\/alpha\.ts/).first()).toBeVisible()
  await blocks.nth(1).click()
  await expect(main(page).getByText(/src\/bravo\.ts/).first()).toBeVisible()

  await band.click()
  await expect(main(page).getByTestId('chat.tool-call.toggle')).toHaveCount(0)
})

test('the Tools dropdown blocks a category for this chat only', async ({ page }) => {
  await bootChat(page)
  await enableAgentMode(page)

  const tools = main(page).getByTestId('chat.tool-permissions.toggle')
  await expect(tools).toBeVisible({ timeout: 10_000 })
  await tools.click()
  const rows = main(page).getByTestId('chat.tool-permission-category.toggle')
  await expect(rows).toHaveCount(8)

  const override = async () => {
    const s = await persistedLocal<{ conversationOverrides: Record<string, Record<string, string>> }>(
      page,
      'locally-uncensored-permissions',
    )
    return Object.values(s?.conversationOverrides ?? {})[0]?.terminal
  }

  const shellRow = rows.filter({ hasText: 'Shell' })
  await shellRow.click()
  // The row writes a per-conversation override, which is the whole point:
  // blocking Shell here must not disarm it everywhere.
  await expect.poll(override).toBe('blocked')

  // Clicking it again lifts the block, so the row is a switch.
  await shellRow.click()
  await expect.poll(override).toBe('auto')

  // The click-away layer closes the dropdown.
  await main(page).getByTestId('chat.tool-permissions.dismiss').click({ position: { x: 5, y: 5 } })
  await expect(main(page).getByTestId('chat.tool-permission-category.toggle')).toHaveCount(0)
})
