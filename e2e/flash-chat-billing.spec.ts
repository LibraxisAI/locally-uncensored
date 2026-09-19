import { test, expect } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME } from './support/tauri-mock'
import { routeCloud, seedOnboardingDone, signInViaGate, cloudSwitch } from './support/cloud-mock'

test('flash metadata and paid fallback reach the actual desktop composer', async ({ page }) => {
  await page.addInitScript(tauriMockInit, { assistantReply: DEFAULT_ASSISTANT_REPLY, modelName: DEFAULT_MODEL_NAME })
  await seedOnboardingDone(page)
  // Die Freimenge gehoert dem Konto und nicht dem Modell: Marke und stehender
  // Satz erscheinen nur bei `paidPlan: true`, weil der Chat-Vermittler nach
  // derselben Regel abrechnet. Ohne die Zeile antwortet `/api/me` ohne das
  // Feld, der Klient schweigt, und der Fall haette nichts zu sehen.
  await routeCloud(page, { license: 'active', access: true, mediaLive: true, paidPlan: true })
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
  // Der Aufdruck der Marke ist zweimal gewandert: "Flash", dann "No credits",
  // dann "Included". David am 12.09.2026 endgueltig zurueck auf "No credits",
  // weil "Included" nur sagt, dass etwas dabei ist. Dass die Marke am KONTO
  // haengt, traegt die Logik daneben und der Titel, nicht das Etikett. Die
  // Zeile selbst ist unveraendert, nur ihr Aufdruck. Sie steht weiterhin in
  // der Modellauswahl selbst (`ModelRowMarks`), unabhaengig vom Etikett in
  // der Sitzungsleiste.
  const marke = row.getByText('No credits', { exact: true })
  await expect(marke).toBeVisible()
  await expect(marke).toHaveAttribute('title', 'No credits on your plan, up to 50,000 tokens per day.')
  await row.click()

  // Runde 3 (Abnahme 19.09.2026, Blocker A2): kein Dauerband mehr ueber der
  // Eingabe. Der Hinweis ist ein Etikett neben dem Agent-Schalter, das ein
  // Popup oeffnet statt Platz zu beanspruchen, genau wie der Sampling-Regler.
  const trigger = page.getByTestId('flash-chat-notice-trigger')
  const panel = page.getByTestId('flash-chat-notice-panel')
  const composer = page.locator('textarea').first()

  await expect(trigger).toBeVisible()
  await expect(trigger).toHaveText('Using no credits')
  await expect(panel).toBeHidden()

  // Der Composer darf sich nicht bewegen, weder beim Oeffnen noch beim
  // Schliessen: das war der Fehler des alten Dauerbandes, das den
  // Agent-Schalter und alles darunter nach oben schob.
  const composerTopBeforeOpen = (await composer.boundingBox())!.y

  await trigger.click()
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('50,000 input and output tokens')
  const composerTopWhileOpen = (await composer.boundingBox())!.y
  expect(composerTopWhileOpen).toBeCloseTo(composerTopBeforeOpen, 0)

  // Das X schliesst.
  await page.getByTestId('flash-chat-notice-close').click()
  await expect(panel).toBeHidden()
  const composerTopAfterClose = (await composer.boundingBox())!.y
  expect(composerTopAfterClose).toBeCloseTo(composerTopBeforeOpen, 0)

  // Escape schliesst ebenfalls.
  await trigger.click()
  await expect(panel).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()

  await composer.fill('Say hello')
  await composer.press('Enter')
  await trigger.click()
  await expect(panel.getByRole('status')).toContainText('41,000')
  await expect(page.getByText('Flash browser proof 1.', { exact: true })).toBeVisible()
  await page.getByTestId('flash-chat-notice-close').click()
  await expect(panel).toBeHidden()

  await expect(async () => {
    if (requests < 2) {
      await composer.fill('Say hello again')
      await composer.press('Enter')
    }
    expect(requests).toBe(2)
  }).toPass({ timeout: 10000 })
  await trigger.click()
  await expect(panel.getByRole('alert')).toContainText('uses credits')
  await expect(page.getByText('Flash browser proof 2.', { exact: true })).toBeVisible()
})
