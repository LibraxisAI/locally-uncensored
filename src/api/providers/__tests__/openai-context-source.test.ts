/**
 * GH #129, "[Bug]: token" (nicolasoliver1jclj1, 2026-09-11).
 *
 * Ein eigener OpenAI-kompatibler Server, ein Modell mit 256k Kontext. LU zeigte
 * "6.4K", bot keinen Fensterwaehler an, und nach dem Umbenennen des Modells auf
 * etwas mit "qwen" im Namen "25.6K" plus die Antwort "token limit exceeded" vom
 * eigenen Server.
 *
 * Die Gegenprobe unten rechnet beide Zahlen nach (sie sind kein Zufall) und
 * haelt danach fest, was stattdessen herauskommen muss.
 *
 * HIER LAEUFT KEIN SERVER. Das Netz ist gemockt; die Formen der Antworten
 * stammen aus der Dokumentation von llama.cpp, vLLM und KoboldCpp.
 *
 * Run: npx vitest run src/api/providers/__tests__/openai-context-source.test.ts
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

const localFetch = vi.fn()
const localFetchStream = vi.fn()

vi.mock('../../backend', async () => {
  const actual = await vi.importActual<typeof import('../../backend')>('../../backend')
  return {
    ...actual,
    isTauri: () => false,
    localFetch: (...a: Parameters<typeof import('../../backend').localFetch>) => localFetch(...a),
    localFetchStream: (...a: Parameters<typeof import('../../backend').localFetchStream>) => localFetchStream(...a),
    ensureProxyAllowsHost: async () => {},
  }
})

import { OpenAIProvider } from '../openai-provider'
import type { ProviderConfig, ChatStreamChunk } from '../types'
import { resolveActiveWindow, windowIsAdjustable, windowIsKnown, capIsDerivable } from '../../../lib/context-source'
import { effectiveSendWindow } from '../../../lib/send-window'
import { formatContextWindow } from '../../../lib/formatters'
import { useSettingsStore } from '../../../stores/settingsStore'

/** Der Aufbau des Melders: ein eigener Server, LAN, Basis-URL OHNE /v1. */
function reporterConfig(port: number, baseSuffix = ''): ProviderConfig {
  return {
    id: 'openai', name: 'My server', enabled: true,
    baseUrl: `http://192.168.4.${port % 200}:${port}${baseSuffix}`, apiKey: '', isLocal: true,
  }
}

/** llama.cpp /props, gekuerzt. n_ctx ist das wirklich geladene Fenster. */
const PROPS_262K = {
  default_generation_settings: { id: 0, n_ctx: 262144, params: { n_predict: -1 } },
  total_slots: 1,
  model_path: '/models/my-model.gguf',
}

/** Beantwortet nur die URLs, die dieser Server wirklich kennt. */
function serveLlamaCpp(props: unknown = PROPS_262K) {
  localFetch.mockImplementation(async (url: string) => {
    if (String(url).endsWith('/props')) {
      return new Response(JSON.stringify(props), { status: 200 })
    }
    return new Response('{"error":"not found"}', { status: 404 })
  })
}

async function drain(gen: AsyncGenerator<ChatStreamChunk>): Promise<ChatStreamChunk[]> {
  const out: ChatStreamChunk[] = []
  for await (const c of gen) out.push(c)
  return out
}

function sentBody(): Record<string, unknown> {
  return JSON.parse(String(localFetchStream.mock.calls[0][1].body))
}

beforeEach(() => {
  useSettingsStore.getState().updateSettings({ contextWindowByModel: {} })
})

afterEach(() => {
  vi.restoreAllMocks()
  localFetch.mockReset()
  localFetchStream.mockReset()
  useSettingsStore.getState().updateSettings({ contextWindowByModel: {} })
})

describe('GH #129: woher das Fenster kommt', () => {
  it('der alte Weg erklaert die gemeldeten 6.4K und 25.6K', () => {
    // Kein Aufruf von Produktionscode mit Absicht: das hier ist die Rechnung,
    // die der Melder auf dem Schirm hatte, damit die Zahlen im Fehlerbericht
    // nachpruefbar an einer Stelle stehen.
    const guessedPlain = 8192      // guessContextFromName, letzter Boden
    const guessedQwen = 32768      // guessContextFromName, Zweig "qwen"
    const asCloud = (w: number) =>
      formatContextWindow(effectiveSendWindow({ providerId: 'openai', modelWindow: w }))
    expect(asCloud(guessedPlain)).toBe('6.4K')
    expect(asCloud(guessedQwen)).toBe('25.6K')
  })

  it('eine Basis-URL ohne /v1 wird abgefragt statt uebergangen', async () => {
    const provider = new OpenAIProvider(reporterConfig(8081))
    serveLlamaCpp()

    const got = await provider.getContextWindow('my-model')

    expect(got.tokens).toBe(262144)
    expect(got.source).toBe('probe')
    const urls = localFetch.mock.calls.map(([u]) => String(u))
    expect(urls).toContain('http://192.168.4.81:8081/props')
    // Der /v1-Weg wird trotzdem versucht, nur eben zusaetzlich abgeleitet.
    expect(urls.some((u) => u.startsWith('http://192.168.4.81:8081/v1/models/'))).toBe(true)
  })

  it('dieselbe Abfrage laeuft auch, wenn die Basis auf /v1 endet', async () => {
    const provider = new OpenAIProvider(reporterConfig(8082, '/v1'))
    serveLlamaCpp()

    const got = await provider.getContextWindow('my-model')

    expect(got.tokens).toBe(262144)
    expect(localFetch.mock.calls.map(([u]) => String(u)))
      .toContain('http://192.168.4.82:8082/props')
  })

  it('vLLM wird ueber die Modellliste erkannt', async () => {
    const provider = new OpenAIProvider(reporterConfig(8083, '/v1'))
    localFetch.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/v1/models')) {
        return new Response(JSON.stringify({
          object: 'list',
          data: [{ id: 'my-model', object: 'model', owned_by: 'vllm', max_model_len: 40960 }],
        }), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    })

    expect((await provider.getContextWindow('my-model')).tokens).toBe(40960)
  })

  it('KoboldCpp wird ueber seinen eigenen Endpunkt erkannt', async () => {
    const provider = new OpenAIProvider(reporterConfig(8084))
    localFetch.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/api/extra/true_max_context_length')) {
        return new Response(JSON.stringify({ value: 16384 }), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    })

    const got = await provider.getContextWindow('my-model')
    expect(got.tokens).toBe(16384)
    expect(got.source).toBe('probe')
  })

  it('antwortet niemand, bleibt es bei geraten', async () => {
    const provider = new OpenAIProvider(reporterConfig(8085))
    localFetch.mockImplementation(async () => new Response('{}', { status: 404 }))

    const got = await provider.getContextWindow('a-name-nobody-knows')
    expect(got.source).toBe('guess')
    expect(got.tokens).toBe(8192)
  })

  it('ein fremder Host im Internet wird nicht abgefragt', async () => {
    const provider = new OpenAIProvider({
      id: 'openai', name: 'Remote', enabled: true,
      baseUrl: 'https://api.example.com/v1', apiKey: 'sk-x', isLocal: false,
    })
    localFetch.mockImplementation(async () => new Response('{}', { status: 200 }))

    const got = await provider.getContextWindow('a-name-nobody-knows')
    expect(got.source).toBe('guess')
    expect(localFetch).not.toHaveBeenCalled()
  })

  it('die Wahl des Nutzers schlaegt die Abfrage und heisst so', async () => {
    const provider = new OpenAIProvider(reporterConfig(8086))
    serveLlamaCpp()
    useSettingsStore.getState().updateSettings({
      contextWindowByModel: { [provider.contextWindowKey('my-model')]: 32768 },
    })

    const got = await provider.getContextWindow('my-model')
    expect(got).toEqual({ tokens: 32768, source: 'user', modelMax: 0 })
    expect(localFetch).not.toHaveBeenCalled()
  })
})

describe('GH #129: wer das Fenster verstellen darf', () => {
  it('ein eigenes Backend mit geratenem Fenster ist verstellbar', () => {
    expect(windowIsAdjustable({ source: 'guess', localBackend: true })).toBe(true)
    expect(windowIsAdjustable({ source: 'user', localBackend: true })).toBe(true)
    // Auch ein gemessenes lokales Fenster bleibt verstellbar: es ist eine
    // Obergrenze auf eigener Hardware, und Ollama, LM Studio und der LU-Motor
    // halten es seit jeher genauso.
    expect(windowIsAdjustable({ source: 'probe', localBackend: true })).toBe(true)
  })

  it('ein fremdes, festes Fenster ist es nicht', () => {
    expect(windowIsAdjustable({ source: 'probe', localBackend: false })).toBe(false)
    expect(windowIsAdjustable({ source: 'guess', localBackend: false })).toBe(false)
  })

  it('nur ein gemessenes oder gesetztes Fenster gilt als bekannt', () => {
    expect(windowIsKnown('probe')).toBe(true)
    expect(windowIsKnown('user')).toBe(true)
    expect(windowIsKnown('guess')).toBe(false)
  })
})

describe('GH #129: max_tokens wird nicht mehr geraten', () => {
  it('ein geratenes Fenster legt gar kein max_tokens auf die Leitung', async () => {
    const provider = new OpenAIProvider(reporterConfig(8087))
    localFetch.mockImplementation(async () => new Response('{}', { status: 404 }))
    localFetchStream.mockResolvedValue(new Response('data: [DONE]\n\n', { status: 200 }))

    await drain(provider.chatStream('a-name-nobody-knows', [{ role: 'user', content: 'hi' }]))

    expect(sentBody()).not.toHaveProperty('max_tokens')
  })

  it('ein ausdruecklicher Wunsch des Nutzers geht trotzdem raus', async () => {
    const provider = new OpenAIProvider(reporterConfig(8088))
    localFetch.mockImplementation(async () => new Response('{}', { status: 404 }))
    localFetchStream.mockResolvedValue(new Response('data: [DONE]\n\n', { status: 200 }))

    await drain(provider.chatStream(
      'a-name-nobody-knows',
      [{ role: 'user', content: 'hi' }],
      { maxTokens: 1024 },
    ))

    expect(sentBody().max_tokens).toBe(1024)
  })

  it('ein gemessenes Fenster bekommt weiter seinen Deckel', async () => {
    const provider = new OpenAIProvider(reporterConfig(8089))
    serveLlamaCpp({ default_generation_settings: { n_ctx: 16384 } })
    localFetchStream.mockResolvedValue(new Response('data: [DONE]\n\n', { status: 200 }))

    await drain(provider.chatStream('my-model', [{ role: 'user', content: 'hi' }]))

    const cap = sentBody().max_tokens
    expect(typeof cap).toBe('number')
    expect(cap as number).toBeGreaterThan(0)
    expect(cap as number).toBeLessThanOrEqual(16384)
  })

  it('ein benanntes Modell aus der gepflegten Liste behaelt seinen Deckel (Bug 5)', async () => {
    // Die Ausnahme mit Namen: `KNOWN_CONTEXT` ist eine Liste exakter Ids mit
    // veroeffentlichten Fenstern, keine Teilzeichenketten-Heuristik. Sie
    // schuetzt seit dem 2026-07-11 vor DeepInfras Ueberdeckelung, und #129
    // nimmt ihr das nicht weg.
    const provider = new OpenAIProvider({
      id: 'openai', name: 'Remote', enabled: true,
      baseUrl: 'https://api.example.com/v1', apiKey: 'sk-x', isLocal: false,
    })
    localFetchStream.mockResolvedValue(new Response('data: [DONE]\n\n', { status: 200 }))

    const got = await provider.getContextWindow('gpt-4o')
    expect(got.guessKind).toBe('table')
    expect(capIsDerivable(got)).toBe(true)
    expect(capIsDerivable({ source: 'guess', guessKind: 'name' })).toBe(false)

    await drain(provider.chatStream('gpt-4o', [{ role: 'user', content: 'hi' }]))
    const cap = sentBody().max_tokens
    expect(typeof cap).toBe('number')
    expect(cap as number).toBeGreaterThan(0)
    expect(cap as number).toBeLessThanOrEqual(128000)
  })

  it('ein vom Nutzer gesetztes Fenster zaehlt als bekannt', async () => {
    const provider = new OpenAIProvider(reporterConfig(8090))
    localFetch.mockImplementation(async () => new Response('{}', { status: 404 }))
    localFetchStream.mockResolvedValue(new Response('data: [DONE]\n\n', { status: 200 }))
    useSettingsStore.getState().updateSettings({
      contextWindowByModel: { [provider.contextWindowKey('a-name-nobody-knows')]: 4096 },
    })

    await drain(provider.chatStream('a-name-nobody-knows', [{ role: 'user', content: 'hi' }]))

    const cap = sentBody().max_tokens
    expect(typeof cap).toBe('number')
    expect(cap as number).toBeLessThanOrEqual(4096)
  })
})

describe('GH #129: die Gegenprobe zum Fehlerbericht', () => {
  it('256k gemeldet, 256k gezeigt, und der Waehler ist da', async () => {
    const provider = new OpenAIProvider(reporterConfig(8091))
    serveLlamaCpp()

    const resolved = await provider.getContextWindow('my-model')
    const win = resolveActiveWindow({ resolved, localBackend: true })

    // Der Nenner des Zaehlers: sendWindow, sonst contextWindow (TokenCounter).
    const denominator = win.sendWindow > 0 ? win.sendWindow : win.contextWindow
    expect(denominator).toBe(262144)
    expect(formatContextWindow(denominator)).toBe('256K')
    // ContextDropdown rendert den Waehler genau dann, wenn das hier wahr ist.
    expect(win.adjustable).toBe(true)
    expect(win.source).toBe('probe')
    // Und nicht mehr das, was der Melder sah.
    expect(formatContextWindow(denominator)).not.toBe('6.4K')
    expect(formatContextWindow(denominator)).not.toBe('25.6K')
  })
})
