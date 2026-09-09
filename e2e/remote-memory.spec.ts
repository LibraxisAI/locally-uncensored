import { expect, test } from '@playwright/test'

for (const fail of [false, true]) {
  test(`actual sensitive control ${fail ? 'reports unconfirmed native failure' : 'requests Remote revocation'}`, async ({ page }, testInfo) => {
    await page.addInitScript(({ fail }) => {
      const calls: string[] = []
      Object.defineProperty(window, 'remoteProofCalls', { value: calls })
      Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {
        invoke: async (command: string) => {
          calls.push(command)
          if (fail && ['revoke_remote_memory', 'stop_remote_server'].includes(command)) throw new Error('Synthetic native failure')
          if (command === 'start_remote_server') return { port: 11435, passcode: 'fixture', passcodeExpiresAt: 1, lanUrl: '', mobileUrl: '' }
          if (command === 'remote_qr_code') return { qr_png_base64: '', url: '', passcode: '' }
          if (command === 'revoke_remote_memory') return null
          throw new Error('Unsupported proof command')
        },
      } })
    }, { fail })
    await page.goto('/e2e/remote-memory-proof.html')
    await page.getByRole('button', { name: 'Add Memory', exact: true }).click()
    await page.getByPlaceholder('What should I remember?').fill('Remote proof preference')
    await page.getByPlaceholder('Details… (required)').fill('Synthetic remembered preference')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByRole('button', { name: 'Start proof remote session' }).click()
    await expect(page.locator('#remote-state')).toContainText('"qrVisible":true')
    await page.getByLabel('Sensitive: exclude from AI requests').check()
    await expect(page.getByRole('status')).toContainText(fail ? 'could not be confirmed' : 'Restart Remote Access and reconnect')
    await expect(page.locator('#remote-state')).toHaveText('{"enabled":true,"qrVisible":false}')
    expect(await page.evaluate(() => (window as unknown as { remoteProofCalls: string[] }).remoteProofCalls)).toContain('revoke_remote_memory')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: testInfo.outputPath('remote-memory-notice.png'), fullPage: true })
  })
}
