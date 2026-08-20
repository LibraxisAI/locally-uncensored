/* eslint-disable @typescript-eslint/no-explicit-any -- these specs reach into
   the app's own zustand singletons and into the untyped Tauri bridge to build
   preconditions the mocked backend cannot produce; both are `any` by nature,
   same as in tauri-mock.ts. */
import { expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME } from '../tauri-mock'
import { seedOnboardingDone } from '../cloud-mock'

/**
 * Shared boot for the layout journeys (sidebar, header, download tray,
 * update badge, banners, remote panel).
 *
 * Two session markers are set the way the app itself sets them, so the two
 * background effects in AppShell that fire seconds after boot cannot walk
 * over a click mid-journey: the Ollama stale-manifest scan (+3 s) and the
 * local-backend detection, whose selector modal covers the whole shell.
 */
export async function bootLayout(
  page: Page,
  mock: Record<string, unknown> = {},
  opts: { detectBackends?: boolean } = {},
): Promise<void> {
  await page.addInitScript(tauriMockInit, {
    assistantReply: DEFAULT_ASSISTANT_REPLY,
    modelName: DEFAULT_MODEL_NAME,
    ...mock,
  })
  await seedOnboardingDone(page)
  await page.addInitScript((skipDetection) => {
    window.sessionStorage.setItem('lu-model-health-scan-done', '1')
    // Backend detection is what pins Ollama's baseUrl and re-enables it, so a
    // spec that needs Ollama models in the picker has to let it run.
    if (skipDetection) window.sessionStorage.setItem('lu-backend-detection-done', '1')
    // Spec-side tap on the bridge, installed on top of the mock without
    // touching it: several commands the layout fires (pause_download,
    // cancel_download, cancel_model_pull) are answered by the mock but not
    // recorded anywhere, and "the click reached the backend" is exactly what
    // separates a proof from a repaint.
    const w = window as unknown as Record<string, any>
    const bridge = w.__TAURI_INTERNALS__
    const inner = bridge.invoke.bind(bridge)
    w.__E2E_ALL_CALLS__ = []
    bridge.invoke = (cmd: string, args: unknown) => {
      w.__E2E_ALL_CALLS__.push({ cmd, args })
      // No update server exists in e2e. The mock resolves every unmodeled
      // plugin command with 0, which the updater plugin reads as "no update
      // on offer" and which wipes a seeded update out of the store five
      // seconds into every run. A rejection is the honest answer for a
      // machine that cannot reach GitHub, and it is the precondition the
      // badge's own error path is specified against.
      if (cmd === 'plugin:updater|check') {
        return Promise.reject(new Error('e2e: update server unreachable'))
      }
      return inner(cmd, args)
    }
  }, !opts.detectBackends)
  await page.goto('/')
  await expect(page.getByTestId('layout.sidebar.new-chat')).toBeVisible({ timeout: 30_000 })
}

/** Conversation rows in the sidebar. */
export const chatRows = (page: Page) => page.getByTestId('layout.chat-row.open')

/**
 * Click New Chat until the list actually grows. The button is a no-op while
 * `activeModel` is still null (the model list arrives async right after
 * boot), which is exactly what a real user retries.
 */
export async function newChatRow(page: Page): Promise<void> {
  const before = await chatRows(page).count()
  await expect(async () => {
    await page.getByTestId('layout.sidebar.new-chat').click()
    await expect(chatRows(page)).toHaveCount(before + 1, { timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
}

/** Right-click a conversation row to open its context menu. */
export async function openRowMenu(page: Page, index: number): Promise<void> {
  await chatRows(page).nth(index).click({ button: 'right' })
  await expect(page.getByTestId('layout.chat-row-menu.keep-open')).toBeVisible()
}

/** Every command the app sent over the Tauri bridge since boot. */
export async function bridgeCalls(page: Page): Promise<Array<{ cmd: string; args: any }>> {
  return await page.evaluate(() => (window as any).__E2E_ALL_CALLS__ ?? [])
}

export async function bridgeCommands(page: Page): Promise<string[]> {
  return (await bridgeCalls(page)).map((c) => c.cmd)
}
