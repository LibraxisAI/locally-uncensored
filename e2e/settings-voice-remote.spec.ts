import { test, expect } from '@playwright/test'
import {
  openSettings,
  gotoTab,
  openSection,
  readStore,
  lastCall,
  invokeCount,
  VOICE_STORE_KEY,
} from './support/journeys/settings'

/**
 * QA sweep, area `settings`: the Voice & Remote tab.
 *
 * Two surfaces, one rule: the phone must never be handed a power the desktop
 * only pretended to grant. Every permission flip here is checked at the
 * recorded `set_remote_permissions` call, because that struct is what the
 * remote server actually enforces; the blue pill is only its shadow.
 */

const PHONE = {
  id: 'dev-e2e-1',
  ip: '192.168.0.42',
  user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
  last_seen: Math.floor(Date.now() / 1000),
}

test('speech: the TTS engine pick and the read-aloud toggles persist', async ({ page }) => {
  await openSettings(page)
  await gotoTab(page, 'Voice & Remote')
  await openSection(page, 'Speech', 'settings.tts-engine.select')

  const voice = async () => (await readStore(page, VOICE_STORE_KEY))?.state ?? {}

  // ── Engine pick ──────────────────────────────────────────────
  // "External" is not cosmetic: it swaps the whole panel to the HTTP endpoint
  // fields, and the choice has to survive a restart or read-aloud silently
  // falls back to Piper.
  expect((await voice()).ttsMode).toBe('piper')
  await page.getByTestId('settings.tts-engine.select').filter({ hasText: 'External HTTP' }).click()
  await expect.poll(async () => (await voice()).ttsMode).toBe('external')
  await expect(page.getByPlaceholder('http://localhost:8880/v1/audio/speech')).toBeVisible()

  await page.getByTestId('settings.tts-engine.select').filter({ hasText: 'Piper neural' }).click()
  await expect.poll(async () => (await voice()).ttsMode).toBe('piper')
  await expect(page.getByPlaceholder('http://localhost:8880/v1/audio/speech')).toHaveCount(0)

  // ── Inline toggles ───────────────────────────────────────────
  // Read-aloud is the gate; auto-read is a separate opt-in that only exists
  // once the gate is open (#77, where the old single toggle lied about this).
  const readAloud = page.getByTestId('settings.inline-toggle.switch').first()
  expect((await voice()).ttsEnabled).toBe(false)
  await expect(page.getByTestId('settings.inline-toggle.switch')).toHaveCount(1)
  await readAloud.click()
  await expect.poll(async () => (await voice()).ttsEnabled).toBe(true)
  await expect(page.getByTestId('settings.inline-toggle.switch')).toHaveCount(2)

  const autoRead = page.getByTestId('settings.inline-toggle.switch').nth(1)
  await autoRead.click()
  await expect.poll(async () => (await voice()).autoReadAloud).toBe(true)

  // Closing the gate takes auto-read's control away again.
  await readAloud.click()
  await expect.poll(async () => (await voice()).ttsEnabled).toBe(false)
  await expect(page.getByTestId('settings.inline-toggle.switch')).toHaveCount(1)
})

test('remote: every permission flip is pushed to the remote server as a whole struct', async ({ page }) => {
  await openSettings(page)
  await gotoTab(page, 'Voice & Remote')
  await openSection(page, 'Remote Access', 'settings.remote-permission.toggle')

  const toggles = page.getByTestId('settings.remote-permission.toggle')
  await expect(toggles).toHaveCount(4)

  // Filesystem on: the desktop replaces the whole permission struct, so the
  // recorded call must carry the three untouched scopes as false, not omit
  // them, because an omitted scope would read as "keep whatever the server had".
  await toggles.nth(0).click()
  await expect
    .poll(async () => (await lastCall(page, '__E2E_REMOTE_CALLS__', 'set_remote_permissions'))?.permissions)
    .toEqual({ filesystem: true, downloads: false, process_control: false, shell: false })

  // Downloads on top of it: the earlier grant rides along.
  await toggles.nth(1).click()
  await expect
    .poll(async () => (await lastCall(page, '__E2E_REMOTE_CALLS__', 'set_remote_permissions'))?.permissions)
    .toEqual({ filesystem: true, downloads: true, process_control: false, shell: false })

  // Shell is the dangerous one and gets its own warning line.
  await expect(page.getByText(/Risky, leave OFF unless you trust the network/)).toBeVisible()
  await toggles.nth(3).click()
  await expect
    .poll(async () => (await lastCall(page, '__E2E_REMOTE_CALLS__', 'set_remote_permissions'))?.permissions)
    .toEqual({ filesystem: true, downloads: true, process_control: false, shell: true })

  // Revoking is the same round trip in reverse, and the phone loses it at once.
  await toggles.nth(3).click()
  await expect
    .poll(async () => (await lastCall(page, '__E2E_REMOTE_CALLS__', 'set_remote_permissions'))?.permissions)
    .toEqual({ filesystem: true, downloads: true, process_control: false, shell: false })
})

test('remote: a connected phone can be thrown off, and the docs fold open', async ({ page }) => {
  await openSettings(page, { remoteDevices: [PHONE] })
  await gotoTab(page, 'Voice & Remote')
  await openSection(page, 'Remote Access', 'settings.remote-permission.toggle')

  // The phone is listed with the two facts that identify it.
  await expect(page.getByText('Connected Devices (1)')).toBeVisible()
  await expect(page.getByText(PHONE.ip)).toBeVisible()

  // ── Disconnect ───────────────────────────────────────────────
  // Bug #10 history: this trash icon used to call an empty handler. The
  // proof it is wired now is the command reaching Rust with the right id AND
  // the row being gone on the refetch that follows.
  await page.getByTestId('settings.remote-device.disconnect').click()
  await expect
    .poll(async () => (await lastCall(page, '__E2E_REMOTE_CALLS__', 'disconnect_remote_device'))?.deviceId)
    .toBe(PHONE.id)
  await expect(page.getByText(PHONE.ip)).toHaveCount(0)
  await expect(page.getByText(/Connected Devices/)).toHaveCount(0)

  // ── Disclosure ───────────────────────────────────────────────
  // "How it works" is a nested collapsible: its body is absent until asked
  // for, and folds away again.
  const disclosure = page.getByTestId('settings.disclosure.toggle').filter({ hasText: 'How it works' })
  await expect(page.getByText(/Same Wi-Fi|same network/i)).toHaveCount(0)
  await disclosure.click()
  const docsBody = page.getByText(/Dispatch/).first()
  await expect(docsBody).toBeVisible()
  const shown = await page.getByTestId('settings.disclosure.toggle').locator('..').innerText()
  expect(shown.length).toBeGreaterThan('How it works'.length)
  await disclosure.click()
  await page.waitForTimeout(300)
  const hidden = await page.getByTestId('settings.disclosure.toggle').locator('..').innerText()
  expect(hidden.length).toBeLessThan(shown.length)
})

test('remote: the status poll never dispatches a server the user did not ask for', async ({ page }) => {
  // Opening the panel reads status and devices, and that has to stay a READ.
  // A settings visit that silently started the remote server would expose the
  // machine on the LAN without a single click.
  await openSettings(page, { remoteDevices: [PHONE] })
  await gotoTab(page, 'Voice & Remote')
  await openSection(page, 'Remote Access', 'settings.remote-permission.toggle')

  await expect.poll(() => invokeCount(page, 'remote_server_status')).toBeGreaterThan(0)
  await expect.poll(() => invokeCount(page, 'remote_connected_devices')).toBeGreaterThan(0)
  expect(await invokeCount(page, 'start_remote_server')).toBe(0)
  expect(await invokeCount(page, 'start_tunnel')).toBe(0)
})
