/**
 * Which of the four sampling values really reach an LU Cloud request.
 *
 * A project note said "the temperature slider writes to settings.n and has no
 * effect in the cloud". Both halves are wrong, and the note is what sent this
 * check out: there is no `n` anywhere in the app (not in the `Settings`
 * interface in types/settings.ts:49-52, not in DEFAULT_SETTINGS in
 * lib/constants.ts:12-15, and `OpenAIChatRequest` in openai-provider.ts:86-100
 * has no member it could be assigned to), and temperature goes on the wire.
 * SamplingControls writes exactly four keys, all through one setter
 * (SamplingControls.tsx:57 for the three sliders, :72 for Max tokens), and
 * useChat.ts:825-828 hands the same four to the provider.
 *
 * The value that really has no effect in the cloud is TOP K, and that is not a
 * bug to fix here: the OpenAI-compatible body has no field for it. It is read
 * by ollama-provider.ts:150 and anthropic-provider.ts:320 and dropped by
 * openai-provider, which never looks at `options.topK` at all, so the slider
 * works on Ollama and Anthropic and is inert on every OpenAI-protocol backend,
 * LU Cloud and this app's own engine included. Documented on the wire here
 * rather than argued about again.
 *
 * Asserted on the JSON body of a real request, because a note about a slider
 * is exactly the kind of claim that source-reading gets wrong twice.
 *
 * Run: npx vitest run src/api/__tests__/sampling-reaches-the-cloud-body.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { LuCloudProvider } from '../providers/lu-cloud-provider'
import type { OpenAIChatRequest } from '../providers/openai-provider'
import type { ProviderConfig } from '../providers/types'
import { sentJson } from './provider-test-support'
import { useSettingsStore } from '../../stores/settingsStore'
import { DEFAULT_SETTINGS } from '../../lib/constants'

vi.mock('../cloud/supabase', () => ({ getAccessToken: async () => 'session-token-abc' }))

const config: ProviderConfig = {
  id: 'lu-cloud', name: 'LU Cloud', enabled: true,
  baseUrl: 'https://lu-labs.ai/api/inference/v1', apiKey: '', isLocal: false,
}

const okStream = () =>
  new Response('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n', { status: 200 })

const src = (rel: string) =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), rel), 'utf8')

/**
 * The option object useChat.ts:824-838 builds, read out of the live settings
 * store exactly as it reads them. Not a copy of four numbers: if a slider ever
 * stopped writing the key the send reads, this stops carrying the value.
 */
function chatOptsFromSettings() {
  const s = useSettingsStore.getState().settings
  return {
    temperature: s.temperature,
    topP: s.topP,
    topK: s.topK,
    maxTokens: s.maxTokens || undefined,
  }
}

/** One cloud turn, and the JSON body it put on the wire. */
async function cloudBody(): Promise<OpenAIChatRequest> {
  const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okStream())
  const gen = new LuCloudProvider(config).chatStream(
    'zai-org/GLM-5.3',
    [{ role: 'user' as const, content: 'hello' }],
    chatOptsFromSettings(),
  )
  for await (const _ of gen) { /* the fetch only fires on the first next() */ }
  return sentJson<OpenAIChatRequest>(spy.mock.calls)
}

/** Move the sliders, the way SamplingControls does. */
function sliders(patch: Partial<typeof DEFAULT_SETTINGS>) {
  useSettingsStore.getState().updateSettings(patch)
}

beforeEach(() => {
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } })
})
afterEach(() => vi.restoreAllMocks())

describe('what the sliders put on the wire', () => {
  it('carries temperature, top_p and max_tokens under the OpenAI names', async () => {
    sliders({ temperature: 1.35, topP: 0.42, topK: 7, maxTokens: 512 })
    const body = await cloudBody()
    expect(body.temperature).toBe(1.35)
    expect(body.top_p).toBe(0.42)
    expect(body.max_tokens).toBe(512)
  })

  it('carries a temperature of zero, which a truthiness test would eat', async () => {
    // The guard is `!== undefined`, and 0 is the one setting on this panel a
    // user picks on purpose: it is the whole point of the left end of the slider.
    sliders({ temperature: 0 })
    expect((await cloudBody()).temperature).toBe(0)
  })

  it('leaves top_k off the body, because the protocol has no such field', async () => {
    sliders({ topK: 7 })
    const body = await cloudBody()
    expect('top_k' in body).toBe(false)
    expect(JSON.stringify(body)).not.toContain('top_k')
  })

  it('and invents no `n` for any of them', async () => {
    // The claim that started this. There is nothing named `n` on the wire, in
    // the settings, or in the request interface.
    sliders({ temperature: 1.35 })
    const body = await cloudBody() as unknown as Record<string, unknown>
    expect('n' in body).toBe(false)
    expect(Object.keys(useSettingsStore.getState().settings)).not.toContain('n')
  })

  it('COUNTER-CHECK: the defaults are not what was asserted above', async () => {
    // Without this, a body that ignored the settings entirely and sent its own
    // numbers could pass the first case by coincidence.
    const body = await cloudBody()
    expect(body.temperature).toBe(DEFAULT_SETTINGS.temperature)
    expect(body.top_p).toBe(DEFAULT_SETTINGS.topP)
    expect(DEFAULT_SETTINGS.temperature).not.toBe(1.35)
    expect(DEFAULT_SETTINGS.topP).not.toBe(0.42)
  })

  it('sends no max_tokens at all on the auto default of 0', async () => {
    // 0 means "let the server decide", so the field has to be absent rather
    // than present as a zero budget, which would answer nothing.
    expect(DEFAULT_SETTINGS.maxTokens).toBe(0)
    expect((await cloudBody()).max_tokens).toBeUndefined()
  })
})

describe('the panel writes the keys the send reads', () => {
  it('the three sliders and the number field write those four settings', () => {
    const panel = src('../../components/chat/SamplingControls.tsx')
    expect(panel).toMatch(/key: 'temperature'/)
    expect(panel).toMatch(/key: 'topP'/)
    expect(panel).toMatch(/key: 'topK'/)
    expect(panel).toMatch(/update\(\{ maxTokens:/)
    // The slider setter is keyed off the FIELDS table, so it cannot write a
    // name that is not in it.
    expect(panel).toMatch(/update\(\{ \[f\.key\]: Number\(e\.target\.value\) \}\)/)
  })

  it('and the send reads exactly those four', () => {
    const chat = src('../../hooks/useChat.ts')
    expect(chat).toMatch(/temperature: settings\.temperature/)
    expect(chat).toMatch(/topP: settings\.topP/)
    expect(chat).toMatch(/topK: settings\.topK/)
    expect(chat).toMatch(/maxTokens: settings\.maxTokens \|\| undefined/)
  })
})
