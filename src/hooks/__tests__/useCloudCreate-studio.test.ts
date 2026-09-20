/**
 * Die Unterkategorien von Create schicken ein Studio-Modell richtig ab.
 *
 * Port aus uselu (apps/web/hooks/__tests__/useCloudCreate-studio-unterkategorien.test.ts,
 * 19.09.2026): bis dahin war der Studio-Pfad allein im Preset-Fenster zu
 * Hause. Jetzt faehrt ihn auch der normale Composer/useCloudCreate, und daran
 * haengen vier Dinge, die still falsch sein koennen: der Op, die
 * Modelloptionen, und bei einem Clip aus der Galerie die Tatsache, dass der
 * Studio-Pfad ausschliesslich aus dem eigenen Eimer des Kunden liest und
 * keine signierte Adresse annimmt.
 *
 * Abweichung vom Web-Original: das Web kennt eine eigene 'video_upscale'-
 * Absicht (lib/render/create-studio.ts, StudioIntent), die im Desktop-
 * createStore noch nicht existiert (P2-Bericht, "offen fuer P9", P5/P7
 * muessen erst entscheiden, wie sie den Composer erreicht). Der Fall "legt
 * den Galerieclip in den eigenen Eimer" ist deshalb auf die Absicht 'extend'
 * umgestellt: dieselbe Mechanik (ein Clip, der als signierte Adresse
 * vorliegt, geht als HOCHGELADENER Pfad hinaus, nie als Adresse) laesst sich
 * darueber genauso beweisen, ohne eine Absicht vorwegzunehmen, die diesem
 * Paket nicht gehoert.
 *
 * Nichts wird erzeugt: Absenden, Hochladen und Abholen sind gemockt.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('react', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return { ...actual, useCallback: (fn: unknown) => fn }
})

// A full, hand-written mock (no `...actual` spread): the real ../../api/cloud/jobs
// pulls in the Supabase client (api/cloud/supabase.ts), which touches
// `localStorage` at import time and blows up outside a browser-like test
// environment. The established pattern in this directory (see
// useCloudCreate-b3-adult-gate-fires-before-upload.test.ts) is a fake
// CloudJobError/QuoteChangedError pair instead of the real classes.
const hoisted = vi.hoisted(() => {
  class FakeCloudJobError extends Error {
    status: number
    code?: string
    constructor(message: string, status: number, meta?: { code?: string }) {
      super(message)
      this.status = status
      this.code = meta?.code
    }
  }
  class FakeQuoteChangedError extends FakeCloudJobError {
    credits: number
    constructor(message: string, credits: number) {
      super(message, 409, { code: 'quote_changed' })
      this.credits = credits
    }
  }
  const submitted: Array<{ kind: string; model: string; prompt: string; params: Record<string, unknown> }> = []
  const hochgeladen: string[] = []
  return {
    FakeCloudJobError,
    FakeQuoteChangedError,
    submitted,
    hochgeladen,
    uploadInput: vi.fn(async (_blob: unknown, slot: string) => {
      hochgeladen.push(slot)
      return `user-1/staged-${slot}.${slot === 'audio' ? 'mp3' : slot === 'video' ? 'mp4' : 'png'}`
    }),
    getJob: vi.fn(async () => ({ id: 'quelle', result_url: 'https://storage.example/clip.mp4' })),
    submitCloudJob: vi.fn(async (payload: (typeof submitted)[number]) => {
      submitted.push(payload)
      return { id: 'job-test', quota: { cost: 1000, used: 1000, limit: 100000 } }
    }),
    pollJob: vi.fn(async () => ({
      id: 'job-test', kind: 'video', model: 'longcat-avatar', status: 'succeeded',
      result_url: 'https://storage.example/out.mp4', created_at: new Date().toISOString(),
    })),
    cancelJob: vi.fn(async () => ({ status: 'canceled' })),
  }
})
const { submitted, hochgeladen } = hoisted

// Sidesteps loadContentPolicy's own call into ../../api/cloud/jobs
// (getContentPolicy). 'off' keeps clientSafety() to its CSAM-only floor,
// same as an account whose policy has not loaded yet.
vi.mock('../useContentPolicy', () => ({
  contentPolicySnapshot: () => 'off' as const,
  loadContentPolicy: async () => 'off' as const,
}))

vi.mock('../../api/cloud/jobs', () => ({
  uploadInput: hoisted.uploadInput,
  getJob: hoisted.getJob,
  submitCloudJob: hoisted.submitCloudJob,
  pollJob: hoisted.pollJob,
  cancelJob: hoisted.cancelJob,
  CloudJobError: hoisted.FakeCloudJobError,
  QuoteChangedError: hoisted.FakeQuoteChangedError,
}))

import { useCloudCreate } from '../useCloudCreate'
import { useCreateStore } from '../../stores/createStore'

const BILD = { filename: 'portrait.png', url: 'data:image/png;base64,AA', width: 512, height: 512 }
const TON = { name: 'voice.mp3', url: 'blob:voice', blob: new Blob(['x']) }

beforeEach(() => {
  submitted.length = 0
  hochgeladen.length = 0
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x']) })))
  useCreateStore.setState({
    isGenerating: false, error: null, backend: 'cloud',
    source: null, audioInput: null, videoInput: null, voiceFromJob: null,
    extendSource: null, gallery: [], cloudStudioOptions: {},
  })
  useCreateStore.getState().setPrompt('a neutral placeholder line')
})

describe('Studio-Modelle in den Create-Unterkategorien', () => {
  it('schickt einen sprechenden Avatar als Studio-Lauf mit Foto und Tonspur', async () => {
    const s = useCreateStore.getState()
    s.setIntent('lipsync')
    s.setCloudOpModel('longcat-avatar')
    s.setCloudStudioOptions({ resolution: '720p' })
    useCreateStore.setState({ source: BILD, audioInput: TON })
    await useCloudCreate().generate()
    expect(submitted).toHaveLength(1)
    expect(submitted[0].model).toBe('longcat-avatar')
    expect(submitted[0].kind).toBe('video')
    expect(submitted[0].params.op).toBe('studio')
    expect(submitted[0].params.studio_options).toEqual({ resolution: '720p' })
    expect(submitted[0].params.source_path).toBe('user-1/staged-source.png')
    expect(submitted[0].params.audio_path).toBe('user-1/staged-audio.mp3')
  })

  it('laesst den Presenter ohne eigenes Foto starten', async () => {
    const s = useCreateStore.getState()
    s.setIntent('lipsync')
    s.setCloudOpModel('heygen-twin')
    useCreateStore.setState({ source: null, audioInput: TON })
    await useCloudCreate().generate()
    expect(useCreateStore.getState().error).toBeNull()
    expect(submitted).toHaveLength(1)
    expect(submitted[0].params.op).toBe('studio')
    expect(submitted[0].params.audio_path).toBe('user-1/staged-audio.mp3')
  })

  it('wirft einen Rest aus einem anderen Modell weg, statt ihn mitzuschicken', async () => {
    const s = useCreateStore.getState()
    s.setIntent('lipsync')
    s.setCloudOpModel('longcat-avatar')
    // target_megapixels gehoert dem Upscaler, nicht diesem Endpunkt.
    s.setCloudStudioOptions({ resolution: '480p', target_megapixels: 33 })
    useCreateStore.setState({ source: BILD, audioInput: TON })
    await useCloudCreate().generate()
    expect(submitted[0].params.studio_options).toEqual({ resolution: '480p' })
  })

  it('legt einen fertigen Clip in den eigenen Eimer, statt eine Adresse weiterzureichen', async () => {
    const s = useCreateStore.getState()
    s.setIntent('extend')
    s.setCloudOpModel('preset-wan-2.2-spicy-extend')
    s.setCloudStudioOptions({})
    useCreateStore.setState({ extendSource: { jobId: 'quelle', url: 'https://storage.example/clip.mp4', label: 'clip' } })
    await useCloudCreate().generate()
    expect(submitted).toHaveLength(1)
    expect(submitted[0].params.op).toBe('studio')
    expect(submitted[0].params.video_path).toBe('user-1/staged-video.mp4')
    // Genau das darf NICHT passieren: der Studio-Pfad liest keine Adressen.
    expect(submitted[0].params.source_url).toBeUndefined()
  })

  it('schickt bei Musik keine Felder aus unserer eigenen Preistabelle mit', async () => {
    const s = useCreateStore.getState()
    s.setIntent('music')
    s.setCloudOpModel('eleven-music')
    s.setCloudStudioOptions({})
    await useCloudCreate().generate()
    expect(submitted[0].params.op).toBe('studio')
    expect(submitted[0].kind).toBe('audio')
    expect(submitted[0].params.duration).toBeUndefined()
  })

  it('laesst eine klassische Wahl unveraendert ihren alten Weg gehen', async () => {
    const s = useCreateStore.getState()
    s.setIntent('music')
    s.setCloudOpModel('ace-step')
    await useCloudCreate().generate()
    expect(submitted[0].model).toBe('ace-step')
    expect(submitted[0].params.op).toBe('music')
    expect(submitted[0].params.duration).toBeDefined()
    expect(submitted[0].params.studio_options).toBeUndefined()
  })

  it('sendet einen UUID-Idempotenzschluessel bei jedem Absenden', async () => {
    const s = useCreateStore.getState()
    s.setIntent('music')
    s.setCloudOpModel('ace-step')
    await useCloudCreate().generate()
    expect(submitted[0].params.client_request_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })
})
