import { expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_MODEL_NAME, type TauriMockOptions } from '../tauri-mock'
import { seedOnboardingDone } from '../cloud-mock'
import { openNewChat } from '../ui'

/**
 * Shared plumbing for the chat-area QA journeys.
 *
 * Every spec here drives the REAL ChatView against the mocked Tauri bridge,
 * so the proof of an element is always what the app does afterwards: text in
 * the transcript, a store value read back out of the page, a recorded bridge
 * call. Nothing in this file asserts; it only gets a spec to the point where
 * a user could start clicking.
 */

export const REPLY = 'ANSWER_MARKER the mocked engine replied.'

/**
 * Boot the app with a chat open and the composer alive.
 *
 * `openNewChat` is not optional: right after onboarding the model list is
 * still loading and Sidebar.handleNewChat drops a click that has no active
 * model, which parks the run on the Models page.
 */
export async function bootChat(page: Page, extra: Partial<TauriMockOptions> = {}): Promise<void> {
  await page.addInitScript(tauriMockInit, {
    assistantReply: REPLY,
    modelName: DEFAULT_MODEL_NAME,
    replyChunkDelayMs: 6,
    ...extra,
  } as TauriMockOptions)
  await seedOnboardingDone(page)
  await page.goto('/')
  await openNewChat(page)
}

/**
 * Give the box a SECOND chat model, so features that need more than one (the
 * group line-up) have something to pick from.
 *
 * Ollama models carry no provider prefix, and useModels only lists them when
 * the provider is enabled with a full object. Otherwise modelStore's
 * validation drops them again at boot. Call before `bootChat`.
 */
export const SECOND_MODEL = 'llama3.1:8b'

export async function seedSecondModel(page: Page): Promise<void> {
  await page.addInitScript(() => {
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
  })
}

/** Everything the transcript, the composer and the top bar live in. */
export function main(page: Page) {
  return page.getByRole('main')
}

/**
 * Text inside the chat surface only. The sidebar repeats the first message as
 * the conversation title, so a bare getByText matches twice.
 */
export function inChat(page: Page, text: string | RegExp) {
  return main(page).getByText(text)
}

/** The composer box. It is the LAST textarea on the surface: an inline message
 *  edit mounts its own textarea inside the list, which sits above it. */
export function composer(page: Page) {
  return main(page).locator('textarea').last()
}

/**
 * Send one message and wait for the whole turn to be over.
 *
 * "Over" is not "the answer is on screen": the visible reply lands a few
 * frames before the run ends, and the composer silently DROPS a send issued
 * while the previous turn still runs (handleSend bails on isGenerating).
 * MessageList withholds the regenerate handler for as long as isGenerating is
 * true, so one more regenerate button is the app's own end-of-turn signal.
 */
export async function send(page: Page, text: string): Promise<void> {
  const box = composer(page)
  await expect(box).toBeVisible({ timeout: 20_000 })
  const regen = page.getByTestId('chat.regenerate-response.click')
  const before = await regen.count()
  // handleSend also carries a 700 ms monotonic lock against key-repeat double
  // sends, and against this mock a whole turn finishes well inside that
  // window. Wait it out rather than watching a send get swallowed.
  await page.waitForTimeout(900)
  await box.fill(text)
  await page.getByTestId('chat.send-message.click').click()
  await expect(regen).toHaveCount(before + 1, { timeout: 30_000 })
  // A send that really went through empties the box; a dropped one leaves the
  // text sitting there.
  await expect(box).toHaveValue('')
}

export interface PersistedConversation {
  id: string
  messages: Array<{ role: string; content: string }>
  personaEnabled?: boolean
  groupModels?: string[]
}

/**
 * The chat store as it really landed on disk.
 *
 * Persistence is coalesced (2.6.3), so a change written this instant is not on
 * disk yet; the trailing timer fires 250 ms after the last set(). Waiting the
 * quiet period out is the honest way to read it, and reading IndexedDB rather
 * than a test-only window handle keeps the proof on the production path.
 */
export async function persistedConversations(page: Page): Promise<PersistedConversation[]> {
  await page.waitForTimeout(700)
  const state = await persistedIdb<{ conversations: PersistedConversation[] }>(page, 'chat-conversations')
  return state?.conversations ?? []
}

/** A zustand store that persists to the app's IndexedDB, read back as JSON. */
export async function persistedIdb<T = Record<string, unknown>>(
  page: Page,
  key: string,
): Promise<T | null> {
  const raw = await page.evaluate<string | null, string>((k) => new Promise((res) => {
    const req = indexedDB.open('locally-uncensored-store', 1)
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', 'readonly')
      const r = tx.objectStore('kv').get(k)
      r.onsuccess = () => res(typeof r.result === 'string' ? r.result : null)
      r.onerror = () => res(null)
    }
    req.onerror = () => res(null)
  }), key)
  return raw ? (JSON.parse(raw).state as T) : null
}

/** A zustand store that persists to localStorage, read back as plain JSON. */
export async function persistedLocal<T = Record<string, unknown>>(
  page: Page,
  key: string,
): Promise<T | null> {
  const raw = await page.evaluate((k) => window.localStorage.getItem(k), key)
  return raw ? (JSON.parse(raw).state as T) : null
}

/**
 * Turn Agent Mode on for the open chat and answer the workspace question with
 * the sandbox. A spec that is about tools, not about workspaces, still has to
 * get past that dialog because it covers the composer.
 */
export async function enableAgentMode(page: Page): Promise<void> {
  const toggle = main(page).getByTestId('chat.agent-mode.toggle')
  await expect(toggle).toBeVisible({ timeout: 20_000 })
  await toggle.click()
  await expect(toggle).toHaveAttribute('title', /Agent Mode is on/i, { timeout: 10_000 })
  const sandbox = page.getByTestId('chat.agent-workspace-sandbox.select')
  if (await sandbox.isVisible().catch(() => false)) await sandbox.click()
  await expect(page.getByText('Where should the agent work?')).toHaveCount(0)
}

/**
 * Type an instruction and hit Enter without waiting for the run to finish.
 *
 * The send is confirmed by the QUESTION appearing in the transcript, and
 * retried if it does not. ChatInput clears the box before the hook decides
 * whether to run, so an empty composer is no proof at all: a send that lands
 * while the model list or the agent workspace is still settling is dropped
 * silently and leaves exactly the same empty box behind. A user in that spot
 * types it again, which is what this does.
 */
export async function instruct(page: Page, text: string): Promise<void> {
  const box = composer(page)
  await expect(box).toBeVisible({ timeout: 20_000 })
  await expect(async () => {
    await page.waitForTimeout(900)
    await box.fill(text)
    await box.press('Enter')
    // A paragraph, not any text: the composer's own value would match too.
    await expect(main(page).locator('p', { hasText: text }).first()).toBeVisible({ timeout: 6_000 })
  }).toPass({ timeout: 45_000 })
}

/** Bridge calls the mock recorded under the given bucket. */
export async function bucket(page: Page, name: string): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(
    (key) => ((window as unknown as Record<string, unknown>)[key] as Array<Record<string, unknown>>) || [],
    name,
  )
}
