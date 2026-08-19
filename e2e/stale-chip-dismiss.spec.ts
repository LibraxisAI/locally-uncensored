import { test, expect } from '@playwright/test'
import { tauriMockInit, DEFAULT_MODEL_NAME } from './support/tauri-mock'
import { seedOnboardingDone } from './support/cloud-mock'
import { openNewChat } from './support/ui'

/**
 * Inventory layout.dismiss.click-4 (FINDINGS.md suspicion 1): the X on the
 * stale-model chip in the header. Dismiss must actually dismiss; before the
 * fix the effect at Header.tsx:114 rebuilt the chip from the health store in
 * the same pass, so the click did nothing a user could see.
 */

const STALE = 'llama3:8b'

test('the stale-model chip stays dismissed after its X is clicked', async ({ page }) => {
  await page.addInitScript(tauriMockInit, {
    assistantReply: 'x',
    modelName: DEFAULT_MODEL_NAME,
    ollamaModels: [STALE],
  })
  await seedOnboardingDone(page)
  // The world of the reporter: an Ollama model is active (Ollama models
  // carry NO provider prefix, see prefixModelName) and the startup health
  // scan has already flagged its manifest as stale.
  await page.addInitScript((stale) => {
    window.localStorage.setItem(
      'chat-models',
      JSON.stringify({ state: { activeModel: stale }, version: 0 }),
    )
    // Ollama must be an ENABLED provider or useModels never lists its
    // models, and setModels' validation would replace the active model
    // with the first chat model it does know (the built-in engine).
    window.localStorage.setItem(
      'lu-providers',
      JSON.stringify({
        state: {
          providers: {
            ollama: { id: 'ollama', name: 'Ollama', enabled: true, baseUrl: 'http://localhost:11434', apiKey: '' },
          },
        },
        version: 0,
      }),
    )
    window.localStorage.setItem(
      'locally-uncensored-model-health',
      JSON.stringify({ state: { staleModels: [stale], lastScanTime: 4102444800000, dismissed: false }, version: 0 }),
    )
    // The scan already ran this session and produced the store above; the
    // app's own once-per-session guard makes that a legitimate state and
    // keeps the +3s rescan from racing the click.
    window.sessionStorage.setItem('lu-model-health-scan-done', '1')
  }, STALE)
  await page.goto('/')
  // The picker lives in the chat composer, so a conversation must be open.
  await openNewChat(page)

  // Become the reporter: pick the Ollama model in the header picker. A
  // seeded activeModel loses against boot (the mock's builtin engine is
  // running and loaded, so the app adopts it); the picker click is the
  // real user path and survives it.
  await page.getByTestId('models.select-chat-model.click').click()
  await page.getByTestId('models.model-row.select').filter({ hasText: STALE }).first().click()

  const dismiss = page.getByTestId('layout.dismiss.click-4')
  await expect(dismiss).toBeVisible({ timeout: 20_000 })

  await dismiss.click()

  // Not just gone in the click's own frame: it must STAY gone. The pre-fix
  // bug rebuilt the chip from the health store immediately after the click.
  await expect(dismiss).toBeHidden()
  await page.waitForTimeout(800)
  await expect(dismiss).toBeHidden()
})
