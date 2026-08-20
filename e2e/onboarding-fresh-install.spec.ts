import { test, expect } from '@playwright/test'
import { openNewChat } from './support/ui'
import {
  APP_VERSION,
  backendProbeCount,
  bootOnboarding,
  downloadCalls,
  engineCalls,
  readNotesVersion,
  readSettings,
  reachComfyStep,
  reachModelStep,
} from './support/journeys/onboarding'

/**
 * Journey: a brand-new install, welcome screen to first streamed answer.
 *
 * Every step is asserted by its EFFECT, not by its pixels: the scan actually
 * probed the ports, the wizard actually advanced, the download actually went to
 * the built-in models dir, the engine actually booted on that file, and
 * finishing actually wrote onboardingDone (plus the silent release stamp that
 * keeps a fresh install from being greeted with "what is new").
 */

test('fresh install: welcome → built-in engine → starter model → document chat → first answer', async ({ page }) => {
  await bootOnboarding(page)

  // welcome.start: advances to the backend step AND kicks off the port scan.
  // The probe counter is the proof the scan really ran; the heading alone
  // would only prove a step change.
  await page.getByTestId('onboarding.welcome.start').click()
  await expect(page.getByTestId('onboarding.backends.continue')).toBeVisible({ timeout: 20_000 })
  expect(await backendProbeCount(page)).toBeGreaterThan(0)

  // backends.continue: commits the pre-selected built-in engine into the
  // openai provider slot and moves on (Windows → ComfyUI step).
  await page.getByTestId('onboarding.backends.continue').click()
  await expect(page.getByRole('heading', { name: /Image & Video Generation/i })).toBeVisible()

  // comfyui.skip: straight to the model picker, no ComfyUI involved.
  await page.getByTestId('onboarding.comfyui.skip').click()
  await expect(page.getByRole('heading', { name: /Pick a starter model/i })).toBeVisible()

  // models.toggle-model: selecting flips the footer from "Skip for now" to
  // "Install 1 model"; unselecting flips it back. That footer swap is the
  // observable consequence of the selection state.
  await expect(page.getByTestId('onboarding.models.skip')).toBeVisible()
  await page.getByTestId('onboarding.models.toggle-model').click()
  await expect(page.getByTestId('onboarding.models.download-selected')).toHaveText(/Install 1 model/i)
  await page.getByTestId('onboarding.models.toggle-model').click()
  await expect(page.getByTestId('onboarding.models.skip')).toBeVisible()
  await page.getByTestId('onboarding.models.toggle-model').click()
  await expect(page.getByTestId('onboarding.models.download-selected')).toBeVisible()

  // models.download-selected: writes the GGUF flat into the built-in models
  // dir and boots llama-server on exactly that path, then auto-advances.
  await page.getByTestId('onboarding.models.download-selected').click()
  await expect(page.getByRole('heading', { name: /Document Chat/i })).toBeVisible({ timeout: 30_000 })
  const dl = await downloadCalls(page)
  expect(dl.some((c) => c.filename === 'Qwen2.5-0.5B-Instruct-Q4_K_M.gguf' && c.destDir === '/tmp/lu-e2e/models')).toBe(true)
  const engine = await engineCalls(page)
  expect(engine.some((c) => c.modelPath === '/tmp/lu-e2e/models/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf')).toBe(true)

  // embeddings.install: pulls the embedding GGUF through the same bundled
  // path and starts the embeddings server; the button is replaced by the
  // "Installed" line.
  await page.getByTestId('onboarding.embeddings.install').click()
  await expect(page.getByText(/Installed\. Document Chat is ready\./i)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('onboarding.embeddings.install')).toHaveCount(0)
  const dl2 = await downloadCalls(page)
  expect(dl2.some((c) => String(c.filename).toLowerCase().includes('nomic'))).toBe(true)

  // embeddings.continue: last hop before the closing card.
  await page.getByTestId('onboarding.embeddings.continue').click()
  await expect(page.getByRole('heading', { name: /You're all set/i })).toBeVisible()

  // done.finish: persists onboardingDone, stamps the current release notes
  // silently (so a fresh install never sees the "what is new" sheet), and
  // hands over to the real app.
  await page.getByTestId('onboarding.done.finish').click()
  await expect(page.getByRole('button', { name: /New Chat/i })).toBeVisible({ timeout: 20_000 })
  expect((await readSettings(page)).onboardingDone).toBe(true)
  expect(await readNotesVersion(page)).toBe(APP_VERSION)
  await expect(page.getByTestId('release.notes.dismiss')).toHaveCount(0)

  // The journey's real acceptance: the engine the wizard set up answers.
  await openNewChat(page)
  await page.locator('textarea').first().fill('ping the built-in engine')
  await page.getByRole('button', { name: /Send message/i }).click()
  await expect(page.getByText(/PONG_BUILTIN_OK/)).toBeVisible({ timeout: 20_000 })
})

test('model step: skipping without a selection lands on Document Chat', async ({ page }) => {
  await bootOnboarding(page)
  await reachModelStep(page)

  // models.skip: no model selected, no download started, straight on.
  await page.getByTestId('onboarding.models.skip').click()
  await expect(page.getByRole('heading', { name: /Document Chat/i })).toBeVisible()
  expect(await downloadCalls(page)).toHaveLength(0)
})

test('ComfyUI step is reachable off macOS and Skip does not touch ComfyUI', async ({ page }) => {
  await bootOnboarding(page)
  await reachComfyStep(page)

  await page.getByTestId('onboarding.comfyui.skip').click()
  await expect(page.getByRole('heading', { name: /Pick a starter model/i })).toBeVisible()
  const calls = await page.evaluate(() => ((window as any).__E2E_COMFY_CALLS__ ?? []) as Array<{ cmd: string }>)
  expect(calls.some((c) => c.cmd === 'install_comfyui' || c.cmd === 'start_comfyui')).toBe(false)
})
