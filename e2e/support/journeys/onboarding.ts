import { expect, type Page } from '@playwright/test'
import pkg from '../../../package.json' with { type: 'json' }
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME, type TauriMockOptions } from '../tauri-mock'

/**
 * Journey helpers for the onboarding / auth / release area (QA wave 2026-08-20).
 *
 * The one area that must NOT use seedOnboardingDone: the whole point here is to
 * walk the real wizard. `is_onboarding_done` answers false in the mock and a
 * fresh page has no persisted `chat-settings`, so `page.goto('/')` lands on the
 * welcome step by itself.
 *
 * Platform is pinned to Windows unless a spec says otherwise, because the
 * ComfyUI step only exists off macOS (nextStepAfterBackends in Onboarding.tsx).
 */

type World = Omit<Partial<TauriMockOptions>, 'assistantReply' | 'modelName'>

/**
 * Cut the Vite HMR socket.
 *
 * The wizard is the longest-running surface in the suite (two polled installers
 * back to back), and the dev server this suite runs against is a live working
 * copy: any save under src/ makes the HMR client full-reload the page, which
 * throws the wizard back to the welcome step mid-journey and wipes the mock's
 * recorded invokes. Nothing about the app is changed here, only the dev-time
 * reload channel, which does not exist in a shipped build.
 */
export async function muteHmr(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const RealWebSocket = window.WebSocket
    const dead = {
      addEventListener() {}, removeEventListener() {}, send() {}, close() {},
      readyState: 3, onopen: null, onclose: null, onerror: null, onmessage: null,
    }
    window.WebSocket = function (url: string | URL, protocols?: string | string[]) {
      const isHmr = protocols === 'vite-hmr' || (Array.isArray(protocols) && protocols.includes('vite-hmr'))
      return isHmr ? (dead as unknown as WebSocket) : new RealWebSocket(url, protocols)
    } as unknown as typeof WebSocket
  })
}

/** Fresh install: no persisted settings, wizard from the welcome step. */
export async function bootOnboarding(page: Page, world: World = {}): Promise<void> {
  await muteHmr(page)
  await page.addInitScript(tauriMockInit, {
    assistantReply: DEFAULT_ASSISTANT_REPLY,
    modelName: DEFAULT_MODEL_NAME,
    platform: 'windows',
    ...world,
  } as TauriMockOptions)
  await page.goto('/')
  await expect(page.getByTestId('onboarding.welcome.start')).toBeVisible({ timeout: 20_000 })
}

/**
 * The user the release sheet is FOR: onboarding is behind them, but nothing
 * ever stamped a notes version. seedOnboardingDone (cloud-mock) deliberately
 * writes that stamp; here we deliberately leave it out, which is exactly what
 * shouldShowReleaseNotes reads as "upgraded into this build".
 */
export async function seedUpgrader(page: Page): Promise<void> {
  // Seed ONCE per tab. addInitScript re-runs on every navigation, so an
  // unguarded seed would wipe the stamp again on page.reload(), and the
  // "does not come back after a restart" assertion is the whole point.
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('lu-qa-upgrader-seeded')) return
    window.sessionStorage.setItem('lu-qa-upgrader-seeded', '1')
    window.localStorage.setItem(
      'chat-settings',
      JSON.stringify({ state: { settings: { onboardingDone: true, appMode: 'local' }, _version: 10 }, version: 10 }),
    )
    window.localStorage.removeItem('lu_release_notes')
  })
}

/** Boot straight into the app as an upgrader, with the mock installed. */
export async function bootUpgrader(page: Page, world: World = {}): Promise<void> {
  await muteHmr(page)
  await page.addInitScript(tauriMockInit, {
    assistantReply: DEFAULT_ASSISTANT_REPLY,
    modelName: DEFAULT_MODEL_NAME,
    platform: 'windows',
    ...world,
  } as TauriMockOptions)
  await seedUpgrader(page)
  await page.goto('/')
}

/** Persisted settings blob (settingsStore, zustand/persist → localStorage). */
export async function readSettings(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem('chat-settings')
    return raw ? (JSON.parse(raw).state?.settings ?? {}) : {}
  })
}

/** Persisted provider configs (providerStore → localStorage 'lu-providers'). */
export async function readProviders(page: Page): Promise<Record<string, any>> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem('lu-providers')
    return raw ? (JSON.parse(raw).state?.providers ?? {}) : {}
  })
}

/** Version the release-notes store has stamped, or null. */
export async function readNotesVersion(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem('lu_release_notes')
    return raw ? (JSON.parse(raw).state?.lastNotesVersion ?? null) : null
  })
}

export const APP_VERSION = pkg.version

/**
 * How often the backend detector has probed LM Studio's port. Unique to
 * detectLocalBackends (nothing else in the app asks for :1234/v1/models), so
 * the delta across a click proves a re-scan actually ran rather than the button
 * merely repainting the same list.
 */
export async function backendProbeCount(page: Page): Promise<number> {
  return page.evaluate(() =>
    ((window as any).__E2E_PROXY_URLS__ ?? []).filter((u: string) => u.includes(':1234/v1/models')).length,
  )
}

/** Every URL the app handed to the system browser (plugin:shell|open). */
export async function openedUrls(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as any).__E2E_OPENED_URLS__ ?? [])
}

/** Recorded ComfyUI-surface invokes (install/start/path/cancel). */
export async function comfyCalls(page: Page): Promise<Array<Record<string, any>>> {
  return page.evaluate(() => (window as any).__E2E_COMFY_CALLS__ ?? [])
}

/** Recorded installer invokes (ollama / lmstudio / python / gpu). */
export async function sysCalls(page: Page): Promise<Array<Record<string, any>>> {
  return page.evaluate(() => (window as any).__E2E_SYS_CALLS__ ?? [])
}

/** Recorded model downloads (url / destDir / filename / expectedBytes). */
export async function downloadCalls(page: Page): Promise<Array<Record<string, any>>> {
  return page.evaluate(() => (window as any).__E2E_DL_CALLS__ ?? [])
}

/** Recorded built-in engine launches. */
export async function engineCalls(page: Page): Promise<Array<Record<string, any>>> {
  return page.evaluate(() => (window as any).__E2E_ENGINE_CALLS__ ?? [])
}

/**
 * Open the "Use another engine (Ollama, LM Studio…)" disclosure on the backend
 * step. Everything about detected/installable external backends lives behind
 * it since 2.5.7 moved the built-in engine onto the critical path.
 */
export async function openAnotherEngine(page: Page): Promise<void> {
  await page.getByText(/Use another engine/i).click()
  await expect(page.getByTestId('onboarding.scan-again.click')).toBeVisible()
}

/** Welcome → backend step, with the scan finished. */
export async function reachBackendStep(page: Page): Promise<void> {
  await page.getByTestId('onboarding.welcome.start').click()
  await expect(page.getByTestId('onboarding.backends.continue')).toBeVisible({ timeout: 20_000 })
}

/** Welcome → ComfyUI step over the built-in engine. */
export async function reachComfyStep(page: Page): Promise<void> {
  await reachBackendStep(page)
  await page.getByTestId('onboarding.backends.continue').click()
  await expect(page.getByRole('heading', { name: /Image & Video Generation/i })).toBeVisible()
}

/** Welcome → model picker, skipping ComfyUI. */
export async function reachModelStep(page: Page): Promise<void> {
  await reachComfyStep(page)
  await page.getByTestId('onboarding.comfyui.skip').click()
  await expect(page.getByRole('heading', { name: /Pick a starter model/i })).toBeVisible()
}
