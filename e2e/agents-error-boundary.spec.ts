import { test, expect } from '@playwright/test'
import { bootApp, openSettings, openSection } from './support/journeys/misc'

/**
 * QA sweep, area "ui": the two faces of ErrorBoundary, driven by real crashes
 * instead of a mocked one.
 *
 * A boundary can only be tested by breaking something under it, so both tests
 * poison a PERSISTED STORE the way a bad update or a half-written file would,
 * and then walk the recovery the user is offered. Nothing in the app is
 * patched for this: the corrupt state is the input.
 *
 * Inline card  → the Agent Workflows list renders `workflow.steps.length`, so
 *                a workflow persisted without steps throws inside the Settings
 *                view boundary.
 * Full screen  → the Sidebar filters `conversations` outside every view
 *                boundary, so a null conversation reaches the ROOT boundary in
 *                main.tsx.
 */

/** A workflow record that survives hydration and then throws on render. */
const BROKEN_WORKFLOWS = JSON.stringify({
  state: {
    workflows: [
      { id: 'broken-1', name: 'Broken Workflow', description: 'no steps array', icon: 'Zap', steps: null, variables: {}, isBuiltIn: false },
    ],
    executions: [],
  },
  version: 1,
})

/** chatStore's storage migrates a legacy localStorage copy into IndexedDB. */
const BROKEN_CONVERSATIONS = JSON.stringify({
  state: { conversations: [null], activeConversationId: null },
  version: 0,
})

test('a corrupt workflow store shows the inline card, and Retry brings the page back', async ({ page }) => {
  await page.addInitScript((raw) => {
    window.localStorage.setItem('locally-uncensored-agent-workflows', raw)
  }, BROKEN_WORKFLOWS)
  await bootApp(page, { settingsTab: 'agent' })
  await openSettings(page)

  // The rest of Settings is fine until the broken list is asked to render.
  await expect(page.getByRole('button', { name: 'Personas', exact: true })).toBeVisible()
  await openSection(page, 'Agent Workflows')

  // Effect: the throw was contained: the card replaced the SETTINGS VIEW
  // only, the window is still the app (header and sidebar alive).
  await expect(page.getByText('Something went wrong')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Settings$/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Personas', exact: true })).toHaveCount(0)

  await page.getByTestId('ui.error-boundary.retry').click()

  // Effect: the boundary reset and re-rendered its child: Settings is back on
  // its feet, with the sections collapsed as a fresh mount has them.
  await expect(page.getByText('Something went wrong')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Personas', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Agent Workflows', exact: true })).toBeVisible()

  // And the cause is untouched, so walking back into it fails again: the
  // documented behaviour of Retry, not a silent repair.
  await openSection(page, 'Agent Workflows')
  await expect(page.getByText('Something went wrong')).toBeVisible()
})

test('a corrupt chat store shows the full-screen recovery, and Reload really reloads', async ({ page }) => {
  await page.addInitScript((raw) => {
    window.localStorage.setItem('chat-conversations', raw)
  }, BROKEN_CONVERSATIONS)
  await page.addInitScript(() => {
    // Survives only until a real navigation replaces the JS context.
    ;(window as unknown as { __E2E_PAGE_EPOCH__?: number }).__E2E_PAGE_EPOCH__ = Date.now() + Math.random()
  })
  await bootApp(page, { skipReady: true })

  // Effect: the throw came from ABOVE the view boundaries, so the whole app
  // was replaced by the actionable recovery screen.
  await expect(page.getByText('LU hit a problem')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('ui.fatal-error.reload')).toBeVisible()

  const before = await page.evaluate(() => (window as unknown as { __E2E_PAGE_EPOCH__?: number }).__E2E_PAGE_EPOCH__)
  await page.getByTestId('ui.fatal-error.reload').click()

  // Effect: the document really navigated: the page-lifetime marker is a new
  // one, which nothing but a reload can do.
  await expect
    .poll(
      async () => page.evaluate(() => (window as unknown as { __E2E_PAGE_EPOCH__?: number }).__E2E_PAGE_EPOCH__),
      { timeout: 20_000 },
    )
    .not.toBe(before)
  // The corrupt data is still corrupt, so the same screen comes back: Reload
  // retries, it does not repair.
  await expect(page.getByText('LU hit a problem')).toBeVisible({ timeout: 20_000 })
})

test('Reset settings & reload clears the settings keys and keeps the user data', async ({ page }) => {
  await page.addInitScript((raw) => {
    window.localStorage.setItem('chat-conversations', raw)
  }, BROKEN_CONVERSATIONS)
  await bootApp(page, { skipReady: true })
  await expect(page.getByText('LU hit a problem')).toBeVisible({ timeout: 20_000 })

  // One key from each list, written after boot so no init script re-seeds them.
  await page.evaluate(() => {
    window.localStorage.setItem('workflow-store', '{"marker":"settings"}')
    window.localStorage.setItem('rag-store', '{"marker":"knowledge"}')
  })

  await page.getByTestId('ui.fatal-error.reset-settings').click()

  // Effect: the settings key is gone and the knowledge key survived, which is
  // the promise printed under the button.
  await expect
    .poll(async () => page.evaluate(() => window.localStorage.getItem('workflow-store')), { timeout: 20_000 })
    .toBeNull()
  expect(await page.evaluate(() => window.localStorage.getItem('rag-store'))).toBe('{"marker":"knowledge"}')
})
