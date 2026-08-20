import { expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME, type TauriMockOptions } from '../tauri-mock'
import { seedOnboardingDone } from '../cloud-mock'
import pkg from '../../../package.json' with { type: 'json' }

/**
 * Shared moves for the Settings journeys (QA sweep, area `settings`).
 *
 * Every helper here is a move a real user makes: land on the page, switch a
 * tab, open a collapsed section, read back what the app stored. Nothing here
 * asserts on behalf of a spec; the proof always lives in the spec so the
 * journal can quote it.
 */

export const SETTINGS_STORE_KEY = 'chat-settings'
export const VOICE_STORE_KEY = 'locally-uncensored-voice'
export const PERMISSION_STORE_KEY = 'locally-uncensored-permissions'
export const AGENT_MODE_STORE_KEY = 'locally-uncensored-agent-mode'
export const WORKFLOW_STORE_KEY = 'locally-uncensored-agent-workflows'
export const MEMORY_STORE_KEY = 'locally-uncensored-memory'
export const MCP_STORE_KEY = 'locally-uncensored-mcp-servers'

export type SettingsTabLabel = 'General' | 'AI Backends' | 'Agent' | 'Voice & Remote'

/** Extra knobs the settings journeys need on top of the Tauri mock options. */
export type BootOptions = Partial<TauriMockOptions> & {
  /** false = seed the "onboarding is done" markers only on the FIRST load. */
  seedOnboarding?: boolean
}

/** Boot the app straight into chat with the Tauri bridge mocked. */
export async function bootApp(page: Page, opts: BootOptions = {}): Promise<void> {
  await page.addInitScript(tauriMockInit, {
    assistantReply: DEFAULT_ASSISTANT_REPLY,
    modelName: DEFAULT_MODEL_NAME,
    platform: 'windows',
    ...opts,
  } as TauriMockOptions)
  // Count every command name that crosses the bridge. Several settings
  // controls are pure re-reads (`detect_gpus`, `system_health`) that the mock
  // does not put in a bucket, and "the button asked Rust again" is exactly the
  // effect those buttons promise. This wrapper only counts; it never answers.
  await page.addInitScript(() => {
    const w = window as any
    const internals = w.__TAURI_INTERNALS__
    if (!internals) return
    const inner = internals.invoke.bind(internals)
    w.__E2E_INVOKES__ = []
    internals.invoke = (cmd: string, args?: unknown) => {
      w.__E2E_INVOKES__.push(cmd)
      return inner(cmd, args)
    }
    w.__TAURI__ = internals
  })
  if (opts.seedOnboarding === false) {
    // Seed ONCE, so a reload the app triggers itself (re-run onboarding) is
    // not silently undone by the init script running again.
    await page.addInitScript((appVersion) => {
      if (window.localStorage.getItem('lu-e2e-seeded')) return
      window.localStorage.setItem('lu-e2e-seeded', '1')
      window.localStorage.setItem(
        'chat-settings',
        JSON.stringify({ state: { settings: { onboardingDone: true, appMode: 'local' }, _version: 10 }, version: 10 }),
      )
      window.localStorage.setItem(
        'lu_release_notes',
        JSON.stringify({ state: { lastNotesVersion: appVersion }, version: 0 }),
      )
    }, pkg.version)
  } else {
    await seedOnboardingDone(page)
  }
  await page.goto('/')
}

/** How often `cmd` crossed the bridge so far. */
export function invokeCount(page: Page, cmd: string): Promise<number> {
  return page.evaluate(
    (c) => (((window as any).__E2E_INVOKES__ ?? []) as string[]).filter((x) => x === c).length,
    cmd,
  )
}

/** Boot and land on the Settings page. */
export async function openSettings(page: Page, opts: BootOptions = {}): Promise<void> {
  await bootApp(page, opts)
  await page.getByRole('button', { name: /^Settings$/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 20_000 })
}

/**
 * Click one of the four top-level tabs by its visible label.
 *
 * The tab strip is sticky and sits above a page whose height changes while
 * the whisper / TTS probes land, so the row can still be settling when the
 * spec arrives. A real user just clicks again; retrying until the panel has
 * actually swapped mirrors that instead of racing the probes.
 */
export async function gotoTab(page: Page, label: SettingsTabLabel): Promise<void> {
  const tab = page.getByTestId('settings.tab.switch').filter({ hasText: label })
  await expect(async () => {
    await tab.click({ timeout: 3_000 })
    await expect(tab).toHaveClass(/bg-gray-200/, { timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
}

/** The collapsible <Section> header carrying `title`. */
export function sectionToggle(page: Page, title: string | RegExp) {
  return page.getByTestId('settings.section.toggle').filter({ hasText: title })
}

/**
 * Open a <Section> and wait for its body to be laid out. Sections that ship
 * `defaultOpen` are left alone, since clicking those would close them, so this is
 * safe to call for any section, open or not. `probe` is a locator inside the
 * body used to decide whether the section is already open.
 */
export async function openSection(page: Page, title: string | RegExp, probe?: string): Promise<void> {
  const header = sectionToggle(page, title).first()
  await header.scrollIntoViewIfNeeded()
  const already = probe ? await page.getByTestId(probe).first().isVisible().catch(() => false) : false
  if (!already) {
    // The chevron rotates 90° once the body is mounted, so it reports the
    // section's real state without knowing anything about its contents.
    const open = await header.locator('svg.rotate-90').count()
    if (open === 0) await header.click()
  }
  // The body animates open for 150 ms; give the layout a beat so the first
  // click into it does not land on a moving target.
  await page.waitForTimeout(300)
}

/**
 * Read one persisted zustand store back out of IndexedDB.
 *
 * The chat and memory stores moved off localStorage in 2.5.0 (idbStorage), so
 * reading the old key would report an empty store forever.
 */
export async function readIdbStore<T = any>(page: Page, key: string): Promise<T | null> {
  return page.evaluate(
    (k) =>
      new Promise<any>((resolve) => {
        const req = indexedDB.open('locally-uncensored-store', 1)
        req.onerror = () => resolve(null)
        req.onsuccess = () => {
          const db = req.result
          if (!db.objectStoreNames.contains('kv')) return resolve(null)
          const get = db.transaction('kv', 'readonly').objectStore('kv').get(k)
          get.onerror = () => resolve(null)
          get.onsuccess = () => resolve(typeof get.result === 'string' ? JSON.parse(get.result) : null)
        }
      }),
    key,
  )
}

/**
 * Pre-seed an idb-backed store before the app boots. idbStorage reads the
 * legacy localStorage key when IndexedDB has nothing, so writing there is the
 * supported way to hand a fresh launch a starting state.
 */
export async function seedIdbStore(page: Page, key: string, state: unknown, version = 0): Promise<void> {
  await page.addInitScript(
    ([k, payload]) => window.localStorage.setItem(k as string, payload as string),
    [key, JSON.stringify({ state, version })] as const,
  )
}

/** Read one persisted zustand store back out of localStorage. */
export async function readStore<T = any>(page: Page, key: string): Promise<T | null> {
  return page.evaluate((k) => {
    const raw = window.localStorage.getItem(k)
    return raw ? (JSON.parse(raw) as any) : null
  }, key)
}

/** The `settings` slice of the persisted settings store. */
export async function readSettings(page: Page): Promise<Record<string, any>> {
  const store = await readStore(page, SETTINGS_STORE_KEY)
  return store?.state?.settings ?? {}
}

const bucket = (page: Page, name: string) =>
  page.evaluate((n) => ((window as any)[n] ?? []) as any[], name)

export const sysCalls = (page: Page) => bucket(page, '__E2E_SYS_CALLS__')
export const remoteCalls = (page: Page) => bucket(page, '__E2E_REMOTE_CALLS__')
export const voiceCalls = (page: Page) => bucket(page, '__E2E_VOICE_CALLS__')
export const comfyCalls = (page: Page) => bucket(page, '__E2E_COMFY_CALLS__')
export const engineCalls = (page: Page) => bucket(page, '__E2E_ENGINE_CALLS__')

/** Last recorded call of `cmd` in a bucket, or null. */
export async function lastCall(page: Page, name: string, cmd: string): Promise<any | null> {
  return page.evaluate(
    ([n, c]) => {
      const calls = ((window as any)[n] ?? []) as any[]
      return calls.filter((x) => x.cmd === c).pop() ?? null
    },
    [name, cmd] as const,
  )
}
