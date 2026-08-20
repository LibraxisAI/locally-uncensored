/* eslint-disable @typescript-eslint/no-explicit-any -- these specs reach into
   the app's own zustand singletons and into the untyped Tauri bridge to build
   preconditions the mocked backend cannot produce; both are `any` by nature,
   same as in tauri-mock.ts. */
import { test, expect, type Page } from '@playwright/test'
import { bootLayout, chatRows, newChatRow, bridgeCalls } from './support/journeys/layout'

/**
 * The Remote side of the sidebar: switch to Remote, dispatch a chat over LAN
 * or through the Cloudflare tunnel, and work the LIVE panel, copy, rotate,
 * blow the QR up, restart the server, stop it again.
 *
 * Run: npx playwright test e2e/layout-remote-panel.spec.ts
 */

const panelPasscode = (page: Page) => page.locator('code').filter({ hasText: /^\d{6}$/ }).first()
const panelUrl = (page: Page) => page.locator('code').filter({ hasText: /^http/ }).first()
const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText())

/** Switch to Remote and dispatch a LAN session, the whole way a user does. */
async function dispatchLan(page: Page) {
  await page.getByTestId('layout.remote.click').click()
  await page.getByTestId('layout.sidebar.open-dispatch-picker').click()
  await page.getByTestId('layout.dispatch-picker.start-lan').click()
  await expect(page.getByText('LIVE')).toBeVisible({ timeout: 20_000 })
  await expect(panelPasscode(page)).toHaveText(/^\d{6}$/)
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
})

test('Remote mode dispatches over LAN, copies, rotates, restarts and stops', async ({ page }) => {
  await bootLayout(page)
  // A plain chat first, so "the list shows only dispatched chats" is a claim
  // with something to hide.
  await newChatRow(page)
  await expect(chatRows(page)).toHaveCount(1)

  // layout.remote.click: a different list and a different bottom action.
  await page.getByTestId('layout.remote.click').click()
  await expect(chatRows(page)).toHaveCount(0)
  await expect(page.getByText('No dispatched chats')).toBeVisible()
  await expect(page.getByTestId('layout.sidebar.new-chat')).toHaveCount(0)
  await expect(page.getByTestId('layout.sidebar.open-dispatch-picker')).toBeVisible()

  // layout.sidebar.open-dispatch-picker: the button is replaced by the
  // LAN / Internet choice.
  await page.getByTestId('layout.sidebar.open-dispatch-picker').click()
  await expect(page.getByTestId('layout.dispatch-picker.start-lan')).toBeVisible()
  await expect(page.getByTestId('layout.dispatch-picker.start-internet')).toBeVisible()
  await expect(page.getByTestId('layout.sidebar.open-dispatch-picker')).toHaveCount(0)

  // layout.dispatch-picker.close-overlay: clicking beside the choice puts
  // the Dispatch button back and starts nothing.
  await page.getByTestId('layout.dispatch-picker.close-overlay').click({ position: { x: 10, y: 10 } })
  await expect(page.getByTestId('layout.dispatch-picker.start-lan')).toHaveCount(0)
  await expect(page.getByTestId('layout.sidebar.open-dispatch-picker')).toBeVisible()
  expect((await bridgeCalls(page)).filter((c) => c.cmd === 'start_remote_server')).toHaveLength(0)

  // layout.dispatch-picker.start-lan: asks for the workspace folder, binds
  // it to the remote session, creates the chat, and shows QR, passcode and
  // LAN URL straight away (no tunnel to wait for).
  await page.getByTestId('layout.sidebar.open-dispatch-picker').click()
  await page.getByTestId('layout.dispatch-picker.start-lan').click()
  await expect(page.getByText('LIVE')).toBeVisible({ timeout: 20_000 })
  const calls = await bridgeCalls(page)
  expect(calls.filter((c) => c.cmd === 'pick_folder')).not.toHaveLength(0)
  expect(
    calls.filter((c) => c.cmd === 'set_chat_workspace_override').map((c) => c.args?.path),
  ).toContain('/tmp/lu-e2e/workspace')
  expect(calls.filter((c) => c.cmd === 'start_remote_server')).toHaveLength(1)
  await expect(chatRows(page).nth(0)).toContainText('Remote Chat 1')
  await expect(page.locator('img[alt="QR"]')).toBeVisible()
  await expect(panelUrl(page)).toHaveText(/^http:\/\/[\d.]+:\d+\/mobile$/)

  // layout.remote-panel.copy-passcode: the six digits on screen land in the
  // clipboard, with no visible feedback of any kind.
  const code = (await panelPasscode(page).innerText()).trim()
  await page.getByTestId('layout.remote-panel.copy-passcode').click()
  await expect.poll(() => clipboard(page)).toBe(code)

  // layout.remote-panel.copy-url: same for the mobile URL.
  const url = (await panelUrl(page).innerText()).trim()
  await page.getByTestId('layout.remote-panel.copy-url').click()
  await expect.poll(() => clipboard(page)).toBe(url)

  // layout.remote-panel.regenerate-passcode: a genuinely new code, a fresh
  // QR fetch, and the countdown back at five minutes.
  await page.getByTestId('layout.remote-panel.regenerate-passcode').click()
  await expect(panelPasscode(page)).not.toHaveText(code)
  await expect
    .poll(async () => (await bridgeCalls(page)).filter((c) => c.cmd === 'regenerate_remote_token').length)
    .toBeGreaterThan(0)
  await expect(page.getByText(/^[45]:\d\d$/)).toBeVisible()
  const rotated = (await panelPasscode(page).innerText()).trim()

  // layout.remote-panel.restart-server: the server comes up again with
  // another new passcode, and the chat stays where it is.
  await page.getByTestId('layout.remote-panel.restart-server').click()
  await expect
    .poll(async () => (await bridgeCalls(page)).filter((c) => c.cmd === 'restart_remote_server').length)
    .toBeGreaterThan(0)
  await expect(panelPasscode(page)).not.toHaveText(rotated)
  await expect(chatRows(page).nth(0)).toContainText('Remote Chat 1')

  // layout.remote-panel.stop-dispatch: server down, panel gone, Dispatch
  // button back.
  await page.getByTestId('layout.remote-panel.stop-dispatch').click()
  await expect(page.getByText('LIVE')).toHaveCount(0)
  await expect(page.getByTestId('layout.sidebar.open-dispatch-picker')).toBeVisible()
  await expect
    .poll(async () => (await bridgeCalls(page)).filter((c) => c.cmd === 'stop_remote_server').length)
    .toBeGreaterThan(0)
})

test('the QR blows up into a modal that closes three different ways', async ({ page }) => {
  await bootLayout(page)
  await dispatchLan(page)

  // layout.show-large-qr-code.click: the small QR opens the big one.
  await page.getByTestId('layout.show-large-qr-code.click').click()
  await expect(page.getByTestId('layout.qr-modal.keep-open')).toBeVisible()
  await expect(page.locator('img[alt="QR code"]')).toBeVisible()

  // layout.qr-modal.keep-open: a click on the dialog body is not a click on
  // the backdrop.
  await page.getByTestId('layout.qr-modal.keep-open').click({ position: { x: 5, y: 5 } })
  await expect(page.getByTestId('layout.qr-modal.keep-open')).toBeVisible()

  // layout.copy-passcode.click / layout.copy-url.click: the modal's own copy
  // buttons put the same two values in the clipboard.
  const modal = page.getByTestId('layout.qr-modal.keep-open')
  const code = (await modal.locator('code').filter({ hasText: /^\d{6}$/ }).first().innerText()).trim()
  await page.getByTestId('layout.copy-passcode.click').click()
  await expect.poll(() => clipboard(page)).toBe(code)
  const url = (await modal.locator('code').filter({ hasText: /^http/ }).first().innerText()).trim()
  await page.getByTestId('layout.copy-url.click').click()
  await expect.poll(() => clipboard(page)).toBe(url)

  // layout.close.click: the X closes it and hands the app back.
  await page.getByTestId('layout.close.click').click()
  await expect(page.getByTestId('layout.qr-modal.keep-open')).toHaveCount(0)
  await expect(page.getByTestId('layout.show-large-qr-code.click')).toBeVisible()

  // layout.qr-modal.close-backdrop: so does the dimmed area around it.
  await page.getByTestId('layout.show-large-qr-code.click').click()
  await expect(page.getByTestId('layout.qr-modal.keep-open')).toBeVisible()
  await page.getByTestId('layout.qr-modal.close-backdrop').click({ position: { x: 8, y: 8 } })
  await expect(page.getByTestId('layout.qr-modal.keep-open')).toHaveCount(0)
})

test('hiding the LIVE panel leaves the QR reachable from the chat row', async ({ page }) => {
  await bootLayout(page)
  await dispatchLan(page)
  await expect(page.getByTestId('layout.show-qr-passcode.click')).toBeVisible()

  // layout.hide-qr-panel-reopen-via-the-qr-icon-on-the-chat.click: the whole
  // green panel goes, the row icon stays.
  await page.getByTestId('layout.hide-qr-panel-reopen-via-the-qr-icon-on-the-chat.click').click()
  await expect(page.getByTestId('layout.remote-panel.stop-dispatch')).toHaveCount(0)
  await expect(page.getByTestId('layout.show-large-qr-code.click')).toHaveCount(0)
  await expect(page.getByTestId('layout.show-qr-passcode.click')).toBeVisible()

  // Deselect the chat first, so "without selecting the row" is testable.
  await page.getByTestId('layout.header.logo-home').click()
  await page.getByTestId('layout.remote.click').click()
  await page.evaluate(async () => {
    const mod: any = await import('/src/stores/chatStore.ts')
    mod.useChatStore.getState().setActiveConversation(null)
  })

  // layout.show-qr-passcode.click: opens the big QR and leaves the selection
  // alone.
  await page.getByTestId('layout.show-qr-passcode.click').click()
  await expect(page.getByTestId('layout.qr-modal.keep-open')).toBeVisible()
  expect(
    await page.evaluate(async () => {
      const mod: any = await import('/src/stores/chatStore.ts')
      return mod.useChatStore.getState().activeConversationId
    }),
  ).toBeNull()
})

test('an Internet dispatch withholds the QR until the tunnel is up', async ({ page }) => {
  await bootLayout(page)
  // Cloudflare needs a moment in the real world; the mock hands the tunnel
  // back instantly, which would hide the very state this test is about.
  await page.evaluate(() => {
    const bridge = (window as any).__TAURI_INTERNALS__
    const inner = bridge.invoke.bind(bridge)
    bridge.invoke = (cmd: string, args: unknown) =>
      cmd === 'start_tunnel'
        ? new Promise((resolve) => setTimeout(() => resolve(inner(cmd, args)), 1_500))
        : inner(cmd, args)
  })
  await page.getByTestId('layout.remote.click').click()
  await page.getByTestId('layout.sidebar.open-dispatch-picker').click()

  // layout.dispatch-picker.start-internet: the LAN QR must never flash while
  // Cloudflare is still coming up; the panel says so instead, and the QR
  // appears with the tunnel URL behind it.
  await page.getByTestId('layout.dispatch-picker.start-internet').click()
  await expect(page.getByText(/Connecting to Cloudflare/i).first()).toBeVisible({ timeout: 20_000 })
  // Nothing scannable while the tunnel is still coming up.
  await expect(page.locator('img[alt="QR"]')).toHaveCount(0)
  await expect(page.locator('img[alt="QR"]')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/Connecting to Cloudflare/i)).toHaveCount(0)
  await expect(panelUrl(page)).toHaveText('https://e2e-mock.trycloudflare.com/mobile')
  await expect(chatRows(page).nth(0)).toContainText('Remote Chat 1')
  const calls = await bridgeCalls(page)
  expect(calls.filter((c) => c.cmd === 'pick_folder')).not.toHaveLength(0)
  expect(calls.filter((c) => c.cmd === 'start_tunnel')).toHaveLength(1)
})

test('a failed dispatch explains itself and the notice can be dismissed', async ({ page }) => {
  await bootLayout(page)
  await page.getByTestId('layout.remote.click').click()

  // The state Sidebar.handleDispatch leaves behind when the server refuses to
  // come up: an error, and no dispatched chat (the orphan row is deleted).
  await page.evaluate(async () => {
    const mod: any = await import('/src/stores/remoteStore.ts')
    mod.useRemoteStore.setState({ error: mod.REMOTE_DEV_MODE_ERROR })
  })
  await expect(page.getByText(/Remote Access requires the installed desktop app/i)).toBeVisible()

  // layout.dismiss.click-5: the notice goes and the Dispatch button is alone
  // again, ready for an informed second try.
  await page.getByTestId('layout.dismiss.click-5').click()
  await expect(page.getByText(/Remote Access requires the installed desktop app/i)).toHaveCount(0)
  await expect(page.getByTestId('layout.sidebar.open-dispatch-picker')).toBeVisible()
  expect(
    await page.evaluate(async () => {
      const mod: any = await import('/src/stores/remoteStore.ts')
      return mod.useRemoteStore.getState().error
    }),
  ).toBeNull()
})
