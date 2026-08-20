import { expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME, type TauriMockOptions } from '../tauri-mock'
import { seedOnboardingDone } from '../cloud-mock'

/**
 * Shared plumbing for the models QA journeys (sweep wave, area `models`).
 *
 * Nothing in here asserts a verdict; it only builds the world a real user
 * would already be in before the first click, and hands the spec the raw
 * bridge buckets so every proof can be "what happened afterwards" instead of
 * "the button was on screen".
 *
 * Two things must be pinned or the verdict drifts with the machine that ran
 * it. The PLATFORM decides whether the Models page even has an image/video
 * lane (macOS swaps it for the MLX panel, so the ComfyUI hint and the bundle
 * grid do not exist there). The PROVIDER map decides which backend the page
 * talks to; zustand's persist replaces `providers` wholesale, so a partial
 * seed silently switches the built-in engine off.
 */

/** The GGUF the mocked engine reports, in the picker's prefixed form. */
export const BUILTIN_MODEL = `openai::${DEFAULT_MODEL_NAME}`

export interface ProviderSeed {
  ollamaEnabled?: boolean
  /** Point Ollama at a port the mock refuses, i.e. "Ollama is not running".
   *  /api/tags still answers (the mock keys that off the path), so the models
   *  stay listed while every other Ollama call fails like on a real box. */
  ollamaBaseUrl?: string
  builtinEnabled?: boolean
  /**
   * Keep the seeded map exactly as written. AppShell probes for local
   * backends once per session and re-enables + re-pins the baseUrl of every
   * one it finds, and the shared mock always answers Ollama's /api/tags — so
   * without this, an "Ollama is down" world silently repairs itself on boot.
   * Marking the probe as already done is the same guard the app uses.
   */
  pinProviders?: boolean
}

export interface ModelsWorld {
  mock?: Partial<TauriMockOptions>
  providers?: ProviderSeed
  /** Persisted benchmark measurements, keyed by model name. */
  benchmarkResults?: Record<string, unknown[]>
  /** Persisted stale-model health state (the amber top-of-app banner). */
  health?: { staleModels: string[]; dismissed?: boolean }
}

/** Write the FULL provider map — a partial one drops the built-in engine. */
async function seedProviders(page: Page, seed: ProviderSeed = {}): Promise<void> {
  await page.addInitScript((s: ProviderSeed) => {
    window.localStorage.setItem(
      'lu-providers',
      JSON.stringify({
        state: {
          providers: {
            ollama: {
              id: 'ollama', name: 'Ollama', enabled: s.ollamaEnabled === true,
              baseUrl: s.ollamaBaseUrl || 'http://localhost:11434', apiKey: '', isLocal: true,
            },
            openai: {
              id: 'openai', name: 'Built-in Engine', enabled: s.builtinEnabled !== false,
              baseUrl: 'http://127.0.0.1:8127/v1', apiKey: '', isLocal: true, managed: true,
            },
            anthropic: {
              id: 'anthropic', name: 'Anthropic', enabled: false,
              baseUrl: 'https://api.anthropic.com', apiKey: '', isLocal: false,
            },
            'lu-cloud': {
              id: 'lu-cloud', name: 'LU Cloud', enabled: false,
              baseUrl: 'https://lu-labs.ai/api/inference/v1', apiKey: '', isLocal: false,
            },
          },
          hideBackendSelector: true,
        },
        // providerStore persists at version 1 and ships no migrate function,
        // so a blob stamped 0 is thrown away and the defaults win silently.
        version: 1,
      }),
    )
    if (s.pinProviders) window.sessionStorage.setItem('lu-backend-detection-done', '1')
  }, seed)
}

/** Boot a set-up install straight into chat (no onboarding walk). */
export async function bootApp(page: Page, world: ModelsWorld = {}): Promise<void> {
  await page.addInitScript(tauriMockInit, {
    assistantReply: DEFAULT_ASSISTANT_REPLY,
    modelName: DEFAULT_MODEL_NAME,
    // Windows is the platform that HAS the ComfyUI-backed image/video lane on
    // the Models page. On a Mac the same rails render the MLX panel instead.
    platform: 'windows',
    ...world.mock,
  } as TauriMockOptions)
  await seedOnboardingDone(page)
  await seedProviders(page, world.providers)
  if (world.benchmarkResults) {
    await page.addInitScript((results) => {
      window.localStorage.setItem(
        'lu-benchmark-store',
        JSON.stringify({ state: { results }, version: 0 }),
      )
    }, world.benchmarkResults)
  }
  if (world.health) {
    await page.addInitScript((h: { staleModels: string[]; dismissed?: boolean }) => {
      // Idempotent on purpose: init scripts re-run on every navigation, and a
      // spec that RELOADS to check what survives a restart must not have its
      // seed overwrite whatever the app itself persisted.
      if (window.localStorage.getItem('locally-uncensored-model-health')) return
      window.localStorage.setItem(
        'locally-uncensored-model-health',
        JSON.stringify({
          state: { staleModels: h.staleModels, lastScanTime: 4102444800000, dismissed: !!h.dismissed },
          version: 0,
        }),
      )
      // The once-per-launch scan already ran and produced the state above, so
      // the app's own guard keeps a late rescan from racing the spec.
      window.sessionStorage.setItem('lu-model-health-scan-done', '1')
    }, world.health)
  }
  await page.goto('/')
}

/**
 * Header nav → a view, waited out to that view's own heading.
 *
 * The retry is not padding: the header renders long before the view chunk
 * does, so a click issued in that gap sets the view on a shell that then
 * re-mounts and drops it. A real user clicks again; so does this.
 */
async function openView(page: Page, label: string, heading: string): Promise<void> {
  await expect(async () => {
    await page.getByRole('button', { name: label, exact: true }).first().click()
    await expect(page.getByRole('heading', { name: heading, exact: true }))
      .toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 30_000 })
}

export function openModels(page: Page): Promise<void> {
  return openView(page, 'Models', 'Models')
}

export function openBenchmark(page: Page): Promise<void> {
  return openView(page, 'Benchmark', 'Benchmark')
}

/** The Installed tab, waited out to a first card. */
export async function openInstalled(page: Page): Promise<void> {
  await page.getByTestId('models.tab-installed.select').click()
}

/**
 * Wait until the catalog grid has stopped re-sorting itself.
 *
 * Two async inputs feed the "Start here" ranking: the GPU probe (which
 * decides every tile's fit score) and the installed-model list. Each one
 * lands separately, and a tile whose score changes HOPS between the picks
 * block and the main grid — a different DOM node, so a click issued in that
 * window loses its target. Both are in once the hardware chip shows a GPU and
 * the Installed tab has counted something.
 */
export async function settleCatalog(page: Page): Promise<void> {
  await expect(page.getByText(/^\d+ GB GPU$/)).toBeVisible()
  await expect(page.getByTestId('models.tab-installed.select')).not.toContainText('0')
}

// ── bridge buckets ────────────────────────────────────────────────

async function bucket<T>(page: Page, name: string): Promise<T[]> {
  return (await page.evaluate(
    (n) => (window as unknown as Record<string, unknown[]>)[n] ?? [],
    name,
  )) as T[]
}

/** Every localhost URL the app proxied through Rust (method/body are not
 *  recorded by the shared mock, so a proof can only key on the path). */
export function proxyUrls(page: Page): Promise<string[]> {
  return bucket<string>(page, '__E2E_PROXY_URLS__')
}

export interface DlCall { url: string; destDir: string; filename: string; expectedBytes: number | null }
export function dlCalls(page: Page): Promise<DlCall[]> {
  return bucket<DlCall>(page, '__E2E_DL_CALLS__')
}

export interface ModelCall { cmd: string; name?: string; model?: string; path?: string }
export function modelCalls(page: Page): Promise<ModelCall[]> {
  return bucket<ModelCall>(page, '__E2E_MODEL_CALLS__')
}

export interface EngineCall { cmd: string; modelPath?: string }
export function engineCalls(page: Page): Promise<EngineCall[]> {
  return bucket<EngineCall>(page, '__E2E_ENGINE_CALLS__')
}

/** URLs handed to the system browser via the shell plugin. */
export function openedUrls(page: Page): Promise<string[]> {
  return bucket<string>(page, '__E2E_OPENED_URLS__')
}

/** How often the app hit one Ollama endpoint, e.g. '/api/tags'. */
export async function countProxy(page: Page, path: string): Promise<number> {
  return (await proxyUrls(page)).filter((u) => u.includes(path)).length
}

/** One finished benchmark measurement, in the persisted store's shape. */
export function benchResult(modelName: string, promptId: string, tps: number) {
  return {
    modelName, promptId, tokensPerSec: tps, timeToFirstToken: 40, totalTime: 900,
    totalTokens: 120, thinkTokens: 0, finishReason: 'stop', correct: true,
    timestamp: 1_767_355_200_000,
  }
}
