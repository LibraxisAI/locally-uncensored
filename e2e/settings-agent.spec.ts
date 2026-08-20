import { test, expect } from '@playwright/test'
import {
  openSettings,
  gotoTab,
  openSection,
  readStore,
  PERMISSION_STORE_KEY,
  AGENT_MODE_STORE_KEY,
  WORKFLOW_STORE_KEY,
  MCP_STORE_KEY,
} from './support/journeys/settings'

/**
 * QA sweep, area `settings`: the Agent tab.
 *
 * This tab decides what the agent is allowed to do on the user's machine, so
 * "the pill turned green" is never the proof here. Each permission is read
 * back out of the persisted permission store, which is the copy the tool
 * gate consults before it runs anything.
 *
 * Two dead controls found on this tab during the sweep are fixed and pinned
 * below: the workflow Play button (SettingsPage passed an empty onRun) and
 * "Reset tutorial" (it cleared a flag no component has read since 2.5.9).
 */

async function openAgentTab(page: import('@playwright/test').Page) {
  await openSettings(page)
  await gotoTab(page, 'Agent')
}

const perms = async (page: import('@playwright/test').Page) =>
  (await readStore(page, PERMISSION_STORE_KEY))?.state?.globalPermissions ?? {}

test('permissions: each level lands in the store the tool gate reads, and Reset restores the shipped set', async ({ page }) => {
  await openAgentTab(page)
  await openSection(page, 'Agent Permissions', 'settings.agent-permissions.reset')

  // The innermost row that carries BOTH the category label and its three
  // level buttons. Anchoring on the label alone would also match the card
  // wrapper and the whole section.
  const permRow = (label: string) =>
    page
      .locator('div')
      .filter({ has: page.getByText(label, { exact: true }) })
      .filter({ has: page.getByTestId('settings.agent-permission.set-level') })
      .last()
  const terminalRow = permRow('Terminal / Shell')

  // ── Raise the riskiest category ──────────────────────────────
  // Terminal ships on Ask First. Handing it Auto is the single most dangerous
  // thing this page can do, so the proof is the persisted level, not a colour.
  await expect(
    terminalRow.getByTestId('settings.agent-permission.set-level').filter({ hasText: 'Ask First' }),
  ).toHaveClass(/border-amber-500/)
  await terminalRow.getByTestId('settings.agent-permission.set-level').filter({ hasText: 'Auto' }).click()
  await expect.poll(async () => (await perms(page)).terminal).toBe('auto')

  // ── And all the way down to Blocked ──────────────────────────
  await terminalRow.getByTestId('settings.agent-permission.set-level').filter({ hasText: 'Blocked' }).click()
  await expect.poll(async () => (await perms(page)).terminal).toBe('blocked')

  // ── A second category moves independently ────────────────────
  const webRow = permRow('Web Access')
  await webRow.getByTestId('settings.agent-permission.set-level').filter({ hasText: 'Blocked' }).click()
  await expect.poll(async () => (await perms(page)).web).toBe('blocked')
  expect((await perms(page)).terminal).toBe('blocked')

  // ── Reset ────────────────────────────────────────────────────
  // No confirm on this one, by design: it only ever restores the shipped set.
  await page.getByTestId('settings.agent-permissions.reset').click()
  await expect.poll(async () => (await perms(page)).terminal).toBe('confirm')
  expect((await perms(page)).web).toBe('auto')
})

test('agent hints: the reset button clears the dismissal that actually gates the hint', async ({ page }) => {
  // Regression pin for the sweep fix. The button used to call resetTutorial(),
  // clearing `tutorialCompleted`, a flag no component reads since 2.5.9 took
  // the tutorial modal out. A user who had ticked "never show again" on the
  // agent new-chat hint had no way back. Now the click clears exactly that
  // dismissal, in the persisted store the hint reads at render time.
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'locally-uncensored-agent-mode',
      JSON.stringify({
        state: { agentModeActive: {}, workspaces: {}, sandboxLevel: 'restricted', tutorialCompleted: false, newChatHintDismissed: true },
        version: 0,
      }),
    )
  })
  await openAgentTab(page)
  await openSection(page, 'Agent Permissions', 'settings.agent-permissions.reset')

  const dismissed = async () => (await readStore(page, AGENT_MODE_STORE_KEY))?.state?.newChatHintDismissed
  expect(await dismissed()).toBe(true)

  await page.getByTestId('settings.agent-tutorial.reset').click()
  // The write goes to the persisted store, which is where AgentModeToggle
  // reads it at render time, so the hint is back on the next launch too.
  await expect.poll(dismissed).toBe(false)
  await expect(page.getByTestId('settings.agent-tutorial.reset')).toHaveText('Show agent hints again')
})

test('workflows: the Play button starts a real run that asks for its input and can be cancelled', async ({ page }) => {
  // Regression pin for the sweep fix. SettingsPage passed `onRun={() => {}}`,
  // and it is WorkflowList's only caller, so the Play button on every row was
  // decoration. Proof it runs now: an execution row appears in the persisted
  // workflow store, the first step (`user_input`) asks its question, and
  // Cancel takes the run to 'cancelled' instead of leaving it hanging.
  await openAgentTab(page)
  await openSection(page, 'Agent Workflows', 'settings.workflow-run.panel')

  const executions = async () =>
    ((await readStore(page, WORKFLOW_STORE_KEY))?.state?.executions ?? []) as Array<Record<string, any>>
  expect(await executions()).toEqual([])

  await expect(page.getByText('Research Topic')).toBeVisible()
  await page.getByText('Research Topic').hover()
  await page.getByTestId('agents.run.click').first().click()

  // The run is recorded against the right workflow, not just "something started".
  await expect.poll(async () => (await executions())[0]?.workflowId).toBe('builtin-research-topic')

  // Step 1 is a user_input step, so the runner has to ask. That is the reason a bare
  // startWorkflow() would have been a hang rather than a fix.
  const panel = page.getByTestId('settings.workflow-run.panel')
  await expect(panel).toBeVisible()
  await expect(panel.getByText('What topic should I research?')).toBeVisible()
  await expect.poll(async () => (await executions())[0]?.status).toBe('waiting_input')

  // ── Cancel ───────────────────────────────────────────────────
  await page.getByTestId('settings.workflow-run.cancel').click()
  await expect(panel).toHaveCount(0)
  await expect.poll(async () => (await executions())[0]?.status).toBe('cancelled')
})

test('mcp: a server can be added, and removing it takes it out of the store', async ({ page }) => {
  await openAgentTab(page)
  await openSection(page, 'MCP Servers', 'settings.mcp-form.open')

  const servers = async () => ((await readStore(page, MCP_STORE_KEY))?.state?.servers ?? []) as any[]
  expect(await servers()).toEqual([])

  // ── Cancel first ─────────────────────────────────────────────
  // A cancelled form must not leave a half-built server behind.
  await page.getByTestId('settings.mcp-form.open').click()
  await page.getByPlaceholder('Server name').fill('Scratch')
  await page.getByTestId('settings.mcp-form.cancel').click()
  await expect(page.getByTestId('settings.mcp-form.open')).toBeVisible()
  expect(await servers()).toEqual([])

  // ── Add ──────────────────────────────────────────────────────
  // Name and command are both required, and the args string is split into the
  // argv the spawn will use; a single joined string would break the launch.
  await page.getByTestId('settings.mcp-form.open').click()
  await expect(page.getByTestId('settings.mcp-server.add')).toBeDisabled()
  await page.getByPlaceholder('Server name').fill('Filesystem')
  await expect(page.getByTestId('settings.mcp-server.add')).toBeDisabled()
  await page.getByPlaceholder('Command (e.g. npx, python)').fill('npx')
  await page.getByPlaceholder(/^Args/).fill('-y @modelcontextprotocol/server-filesystem /tmp')
  await page.getByTestId('settings.mcp-server.add').click()

  await expect.poll(async () => (await servers()).length).toBe(1)
  expect((await servers())[0]).toMatchObject({
    name: 'Filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    enabled: true,
  })
  await expect(page.getByText('npx -y @modelcontextprotocol/server-filesystem /tmp')).toBeVisible()
  // The form closes itself and forgets the draft.
  await expect(page.getByTestId('settings.mcp-form.open')).toBeVisible()

  // ── Remove ───────────────────────────────────────────────────
  await page.getByTestId('settings.remove-server.click').click()
  await expect.poll(async () => (await servers()).length).toBe(0)
  await expect(page.getByText('Filesystem')).toHaveCount(0)
})

test('agent: the search provider pick persists and the keys are stored per provider', async ({ page }) => {
  await openAgentTab(page)
  await openSection(page, 'Search Provider', 'settings.search-provider.select')

  const settings = async () => (await readStore(page, 'chat-settings'))?.state?.settings ?? {}
  expect((await settings()).searchProvider).toBe('auto')

  await page.getByTestId('settings.search-provider.select').filter({ hasText: 'Brave Search' }).click()
  await expect.poll(async () => (await settings()).searchProvider).toBe('brave')

  // The key belongs to its own provider, so switching away must not carry it.
  await page.getByPlaceholder('BSA-...').fill('BSA-e2e-key')
  await expect.poll(async () => (await settings()).braveApiKey).toBe('BSA-e2e-key')

  await page.getByTestId('settings.search-provider.select').filter({ hasText: 'Tavily' }).click()
  await expect.poll(async () => (await settings()).searchProvider).toBe('tavily')
  expect((await settings()).braveApiKey).toBe('BSA-e2e-key')
  expect((await settings()).tavilyApiKey).toBe('')
})
