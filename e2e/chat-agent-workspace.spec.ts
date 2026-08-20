import { test, expect } from '@playwright/test'
import { bootChat, send, main, bucket, persistedLocal } from './support/journeys/chat'
import { openNewChat } from './support/ui'

/**
 * QA journey: turning Agent Mode on and answering "where should it work?".
 *
 * Flipping the switch is only half the feature. The chat has to be told which
 * folder the agent may touch, that answer belongs to the conversation, and a
 * chat that already has history is sent to a fresh one instead. This walks the
 * whole decision: cancel it, take the sandbox, swap to a real folder, reuse
 * that folder in the next chat, and finally make it the default.
 */

interface AgentModeState {
  agentModeActive: Record<string, boolean>
  workspaces: Record<string, { kind: string; path?: string }>
  lastFolder?: string
}

interface SettingsState {
  settings: { defaultWorkspace?: { kind: string; path?: string } }
}

const agentState = (page: import('@playwright/test').Page) =>
  persistedLocal<AgentModeState>(page, 'locally-uncensored-agent-mode')

test('Agent Mode asks where to work and the answer sticks to the chat', async ({ page }) => {
  await bootChat(page)
  const toggle = main(page).getByTestId('chat.agent-mode.toggle')
  await expect(toggle).toBeVisible({ timeout: 20_000 })
  await expect(toggle).toHaveAttribute('title', /Agent Mode is off/i)

  // ── on, and the workspace question follows ──────────────────────────
  await toggle.click()
  await expect(toggle).toHaveAttribute('title', /Agent Mode is on/i)
  await expect(page.getByText('Where should the agent work?')).toBeVisible({ timeout: 10_000 })

  // ── cancel: the question goes away, the mode does not ───────────────
  await page.getByTestId('chat.agent-workspace-dialog.cancel').click()
  await expect(page.getByText('Where should the agent work?')).toHaveCount(0)
  await expect(toggle).toHaveAttribute('title', /Agent Mode is on/i)
  // No workspace chosen means no badge, because the bridge falls back to its own
  // per-chat sandbox and the pill has nothing to show.
  await expect(main(page).getByTestId('chat.agent-workspace-badge.open')).toHaveCount(0)

  // ── off and on again re-asks ────────────────────────────────────────
  await toggle.click()
  await expect(toggle).toHaveAttribute('title', /Agent Mode is off/i)
  await toggle.click()
  await expect(page.getByText('Where should the agent work?')).toBeVisible({ timeout: 10_000 })

  // ── the sandbox ─────────────────────────────────────────────────────
  await page.getByTestId('chat.agent-workspace-sandbox.select').click()
  await expect(page.getByText('Where should the agent work?')).toHaveCount(0)
  const badge = main(page).getByTestId('chat.agent-workspace-badge.open')
  await expect(badge).toContainText('Sandbox')
  await expect.poll(async () => {
    const s = await agentState(page)
    return Object.values(s?.workspaces ?? {})[0]?.kind
  }).toBe('sandbox')

  // ── the badge reopens the question, and a real folder replaces it ───
  await badge.click()
  await expect(page.getByText('Where should the agent work?')).toBeVisible()
  await page.getByTestId('chat.agent-workspace-pick-folder.click').click()
  // The native folder picker really ran, and its answer became the workspace.
  await expect
    .poll(async () => (await bucket(page, '__E2E_DIALOG_CALLS__')).filter((c) => c.cmd === 'pick_folder').length)
    .toBe(1)
  await expect(badge).toContainText('workspace')
  await expect.poll(async () => {
    const s = await agentState(page)
    return Object.values(s?.workspaces ?? {})[0]?.path
  }).toBe('/tmp/lu-e2e/workspace')

  // ── the next chat is offered that folder again ──────────────────────
  await openNewChat(page)
  await main(page).getByTestId('chat.agent-mode.toggle').click()
  const useLast = page.getByTestId('chat.use-last-folder.click')
  await expect(useLast).toContainText('/tmp/lu-e2e/workspace')
  await useLast.click()
  await expect(page.getByText('Where should the agent work?')).toHaveCount(0)
  await expect(main(page).getByTestId('chat.agent-workspace-badge.open')).toContainText('workspace')
  // Two conversations, two workspaces: the choice lives on the chat.
  await expect.poll(async () => Object.keys((await agentState(page))?.workspaces ?? {}).length).toBe(2)
  // And the picker was NOT reopened for this one.
  expect((await bucket(page, '__E2E_DIALOG_CALLS__')).filter((c) => c.cmd === 'pick_folder')).toHaveLength(1)

  // ── remember it for every future chat ───────────────────────────────
  await main(page).getByTestId('chat.agent-workspace-badge.open').click()
  // A folder chat reopens straight into the multi-repo manager.
  await expect(page.getByText('Add more repos?')).toBeVisible()
  await page.getByTestId('agent-workspace-remember-default').check()
  await page.getByTestId('chat.agent-workspace-save.click').click()
  await expect(page.getByText('Add more repos?')).toHaveCount(0)
  await expect
    .poll(async () => (await persistedLocal<SettingsState>(page, 'chat-settings'))?.settings.defaultWorkspace?.path)
    .toBe('/tmp/lu-e2e/workspace')
})

test('a chat with history is sent to a fresh one instead of switching in place', async ({ page }) => {
  await bootChat(page)
  await send(page, 'ORDINARY-QUESTION')

  const toggle = main(page).getByTestId('chat.agent-mode.toggle')
  await toggle.click()
  // Agent mode has to be on from the first turn, so an existing thread gets
  // the hint rather than a silent flip.
  await expect(page.getByText('New Chat Required')).toBeVisible({ timeout: 10_000 })
  await expect(toggle).toHaveAttribute('title', /Agent Mode is off/i)

  // ── cancel leaves everything alone ──────────────────────────────────
  await page.getByTestId('chat.agent-new-chat-hint.cancel').click()
  await expect(page.getByText('New Chat Required')).toHaveCount(0)
  await expect(toggle).toHaveAttribute('title', /Agent Mode is off/i)
  await expect(main(page).getByText('ORDINARY-QUESTION')).toBeVisible()

  // ── the offer really opens a new agent chat ─────────────────────────
  await toggle.click()
  await page.getByTestId('chat.agent-new-chat.create').click()
  await expect(page.getByText('New Chat Required')).toHaveCount(0)
  // A different, empty conversation, with the mode already on.
  await expect(main(page).getByText('ORDINARY-QUESTION')).toHaveCount(0)
  await expect(main(page).getByTestId('chat.agent-mode.toggle')).toHaveAttribute('title', /Agent Mode is on/i)
  await expect
    .poll(async () => Object.values((await agentState(page))?.agentModeActive ?? {}).filter(Boolean).length)
    .toBe(1)
})
