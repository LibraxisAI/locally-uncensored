import { test, expect } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME } from './support/tauri-mock'
import { routeCloud, seedOnboardingDone, signInViaGate, cloudSwitch } from './support/cloud-mock'

test('flash metadata and paid fallback reach the actual desktop composer', async ({ page }) => {
  await page.addInitScript(tauriMockInit, { assistantReply: DEFAULT_ASSISTANT_REPLY, modelName: DEFAULT_MODEL_NAME })
  await seedOnboardingDone(page)
  await routeCloud(page, { license: 'active', access: true, mediaLive: true })
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type',
    'access-control-expose-headers': 'x-lu-chat-billing, x-lu-flash-remaining' }
  await page.route('**/api/inference/v1/models', (route) => route.fulfill({ status: 200, headers: cors,
    contentType: 'application/json', body: JSON.stringify({ object: 'list', data: [{
      id: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', name: 'Llama 3.1 8B Turbo',
      context_length: 131072, supports_tools: true, think: 'never', usage_class: 'flash',
      flash: { daily_tokens: 50000, default_max_output: 8192, request_seconds: 240, sessions_only: true, concurrent_requests: 1 },
    }] }),
  }))
  let requests = 0
  await page.route('**/api/inference/v1/chat/completions', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    requests++
    const content = `Flash browser proof ${requests}.`
    return route.fulfill({ status: 200, headers: { ...cors,
      'x-lu-chat-billing': requests === 1 ? 'flash' : 'credits', 'x-lu-flash-remaining': requests === 1 ? '41000' : '0',
    }, contentType: 'text/event-stream', body:
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\ndata: [DONE]\n\n`,
    })
  })
  await page.goto('/')
  await expect(cloudSwitch(page)).toBeVisible()
  await signInViaGate(page)
  await expect(cloudSwitch(page)).toBeChecked()
  await page.getByRole('button', { name: /New Chat/i }).first().click()
  await page.getByRole('button', { name: 'Select chat model', exact: true }).click()
  const row = page.getByRole('button', { name: /Llama 3.1 8B Turbo/ })
  // 7fa4b26b gab beiden Marken denselben Wortlaut in Auswahl und
  // Eingabezeile: aus "Flash" wurde "No credits". Die Zeile selbst ist
  // unveraendert, nur ihr Aufdruck.
  await expect(row.getByText('No credits', { exact: true })).toBeVisible()
  await row.click()
  await expect(page.getByTestId('flash-chat-notice')).toContainText('50,000 input and output tokens')
  const composer = page.locator('textarea').first()
  await composer.fill('Say hello')
  await composer.press('Enter')
  await expect(page.getByTestId('flash-chat-notice').getByRole('status')).toContainText('41,000')
  await expect(page.getByText('Flash browser proof 1.', { exact: true })).toBeVisible()
  await expect(async () => {
    if (requests < 2) {
      await composer.fill('Say hello again')
      await composer.press('Enter')
    }
    expect(requests).toBe(2)
  }).toPass({ timeout: 10000 })
  await expect(page.getByTestId('flash-chat-notice').getByRole('alert')).toContainText('uses credits')
  await expect(page.getByText('Flash browser proof 2.', { exact: true })).toBeVisible()
})
