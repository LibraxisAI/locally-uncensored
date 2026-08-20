import { test, expect } from '@playwright/test'
import { openSettings, gotoTab, openSection, lastCall, comfyCalls } from './support/journeys/settings'

/**
 * QA sweep, area `settings`: the ComfyUI panel on the AI Backends tab.
 *
 * Host, path and port are the three values that decide which machine local
 * image and video generation talks to. Each one has to reach Rust: the app
 * keeps its own copy for the URL builder, and a value that only updates the
 * frontend copy sends the next render at the wrong box.
 */

async function openComfy(page: import('@playwright/test').Page) {
  await openSettings(page)
  await gotoTab(page, 'AI Backends')
  await openSection(page, 'ComfyUI (Image & Video)', 'settings.comfyui-install.start')
}

test('comfyui: host, path and port each reach the backend', async ({ page }) => {
  await openComfy(page)

  // Fresh box: nothing found, and the panel says so rather than implying a
  // healthy install.
  await expect(page.getByText('Not Installed')).toBeVisible()

  // ── Host ─────────────────────────────────────────────────────
  // Set stays inert until the value actually differs from what is stored.
  const setHost = page.getByTestId('settings.comfyui-host.set')
  await expect(setHost).toBeDisabled()
  await page.getByPlaceholder('localhost or server-ip').fill('192.168.0.54')
  await expect(setHost).toBeEnabled()
  await setHost.click()
  await expect.poll(async () => (await lastCall(page, '__E2E_COMFY_CALLS__', 'set_comfyui_host'))?.host).toBe(
    '192.168.0.54',
  )
  await expect(page.getByText('Host saved. Restart ComfyUI to apply.')).toBeVisible()

  // ── Port ─────────────────────────────────────────────────────
  const setPort = page.getByTestId('settings.comfyui-port.set')
  await page.getByPlaceholder('8188').fill('8189')
  await setPort.click()
  await expect.poll(async () => (await lastCall(page, '__E2E_COMFY_CALLS__', 'set_comfyui_port'))?.port).toBe(8189)
  await expect(page.getByText('Port saved. Restart ComfyUI to apply.')).toBeVisible()
})

test('comfyui: connecting an existing install points the app at that folder', async ({ page }) => {
  await openComfy(page)

  // ── Path ─────────────────────────────────────────────────────
  // This is the "I already have ComfyUI" route. Connect must hand the folder
  // to Rust, which is the side that verifies main.py is really there.
  const connect = page.getByTestId('settings.comfyui-path.connect')
  await expect(connect).toBeDisabled()
  await page.getByPlaceholder('C:\\ComfyUI').fill('D:\\AI\\ComfyUI')
  await expect(connect).toBeEnabled()
  await connect.click()
  await expect.poll(async () => (await lastCall(page, '__E2E_COMFY_CALLS__', 'set_comfyui_path'))?.path).toBe(
    'D:\\AI\\ComfyUI',
  )
  await expect(page.getByText('Path set successfully')).toBeVisible()
  // The panel stops calling it missing once the folder is accepted.
  await expect(page.getByText('Not Installed')).toHaveCount(0)

  // ── And pointing that install at another machine ─────────────
  // With a known install, switching the host to a remote box has to change
  // what the panel promises: LU cannot start or stop a process it does not
  // own, and it says so instead of offering dead buttons.
  await page.getByPlaceholder('localhost or server-ip').fill('192.168.0.54')
  await page.getByTestId('settings.comfyui-host.set').click()
  await expect.poll(async () => (await lastCall(page, '__E2E_COMFY_CALLS__', 'set_comfyui_host'))?.host).toBe(
    '192.168.0.54',
  )
  await expect(page.getByText(/Remote ComfyUI, start\/stop\/install not available from LU/)).toBeVisible()
  await expect(page.getByTestId('settings.comfyui-install.start')).toHaveCount(0)
})

test('comfyui: the installer checks Python first and installs into the chosen drive', async ({ page }) => {
  await openComfy(page)

  // ── Install ──────────────────────────────────────────────────
  // The Path field doubles as the install target so a multi-GB install can
  // land on another drive (andy_38747). What is typed there must ride along
  // to `install_comfyui`, not be dropped for the backend default.
  await page.getByPlaceholder('C:\\ComfyUI').fill('D:\\ComfyUI')
  await page.getByTestId('settings.comfyui-install.start').click()

  await expect
    .poll(async () => (await lastCall(page, '__E2E_COMFY_CALLS__', 'install_comfyui'))?.installPath)
    .toBe('D:\\ComfyUI')

  // The install is watched, not fired and forgotten: the progress card shows
  // the backend's own log lines and clears itself when the install completes.
  await expect(page.getByText(/Installing ComfyUI…/).first()).toBeVisible()
  await expect(page.getByTestId('settings.comfyui-install.start')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/Installing ComfyUI…/)).toHaveCount(0)

  // Python is checked before pip is asked to do anything. A missing
  // interpreter is the failure this pre-flight exists to prevent.
  const calls = await comfyCalls(page)
  expect(calls.some((c) => c.cmd === 'install_comfyui')).toBe(true)
})

test('comfyui: opening the panel never starts or installs anything by itself', async ({ page }) => {
  // A settings visit is a read. Spawning a multi-GB install or a GPU process
  // from a page load would be the worst kind of surprise.
  await openComfy(page)
  const calls = await comfyCalls(page)
  expect(calls.filter((c) => ['start_comfyui', 'install_comfyui', 'repair_comfyui_env', 'update_comfyui'].includes(c.cmd))).toEqual([])
})
