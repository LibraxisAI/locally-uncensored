import { expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME, type TauriMockOptions } from '../tauri-mock'
import { routeCloud, seedOnboardingDone, cloudSwitch, type CloudScenario } from '../cloud-mock'

/**
 * Shared journey helpers for the QA sweep wave "misc" (cloud, agents,
 * personas, ui, workflows). Boot + navigation only: every assertion lives in
 * the spec that owns the id, so a reader can see what proved what.
 */

const BASE_OPTS: TauriMockOptions = {
  assistantReply: DEFAULT_ASSISTANT_REPLY,
  modelName: DEFAULT_MODEL_NAME,
  platform: 'windows',
}

export interface BootOptions {
  scenario?: CloudScenario
  /** Settings tab the SettingsPage should boot on (persisted key). */
  settingsTab?: 'general' | 'backends' | 'agent' | 'voice-remote'
  tauri?: Partial<TauriMockOptions>
  /** Skip the "header is up" wait: for specs that boot into a crash screen. */
  skipReady?: boolean
}

/** Boot the app past onboarding in LOCAL mode with the cloud APIs mocked. */
export async function bootApp(page: Page, opts: BootOptions = {}): Promise<void> {
  await page.addInitScript(tauriMockInit, { ...BASE_OPTS, ...opts.tauri })
  await seedOnboardingDone(page)
  if (opts.settingsTab) {
    await page.addInitScript((tab) => {
      window.localStorage.setItem('lu-settings-tab', tab)
    }, opts.settingsTab)
  }
  await routeCloud(page, opts.scenario ?? { license: 'none' })
  await page.goto('/')
  if (!opts.skipReady) await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
}

/** Header nav → Settings, landing on the tab seeded by bootApp. */
export async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Settings$/ }).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 15_000 })
}

/** Expand one collapsible Settings Section by its heading text. */
export async function openSection(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: title, exact: true }).click()
}

/** The persisted settingsStore slice, straight out of localStorage. */
export async function readSettingsState(page: Page): Promise<any> {
  return page.evaluate(() => JSON.parse(window.localStorage.getItem('chat-settings') || '{}').state ?? {})
}

/**
 * The persisted agentWorkflowStore slice, or `null` while the store has never
 * been written. zustand/persist only writes on a state change, so an absent
 * key is itself a fact: nothing in this session touched the workflow store.
 */
export async function readWorkflowState(page: Page): Promise<any | null> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem('locally-uncensored-agent-workflows')
    return raw ? JSON.parse(raw).state : null
  })
}

/** How many workflows the list shows (every row carries exactly one Run). */
export function workflowRows(page: Page) {
  return page.getByTestId('agents.run.click')
}

/**
 * Sign in through the gate the way a user does, tolerating a click that lands
 * during the dialog's entrance animation.
 *
 * cloud-mock's signInViaGate walks intro → plans → sign-in with three blind
 * clicks. Under load the gate re-renders on the probe that fires when it opens,
 * and a click that was mid-flight is simply lost: the same race
 * `support/ui.ts:openNewChat` already handles for New Chat. A real user clicks
 * again; so does this.
 */
export async function signInViaGateStable(page: Page): Promise<void> {
  await cloudSwitch(page).click()
  const email = page.getByPlaceholder('Email')
  await expect(async () => {
    if (await email.isVisible().catch(() => false)) return
    const fromIntro = page.getByTestId('cloud.gate.goto-login-from-intro')
    if (await fromIntro.isVisible().catch(() => false)) await fromIntro.click({ timeout: 2_000 })
    await expect(email).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })

  await email.fill('qa@lu-labs.ai')
  await page.getByPlaceholder('Password').fill('e2e-password')
  await page.getByRole('button', { name: /^Sign in$/i }).click()
}

/** URLs the mocked shell-open recorder saw (openExternal). */
export async function openedUrls(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __E2E_OPENED_URLS__?: string[] }).__E2E_OPENED_URLS__ ?? [])
}
