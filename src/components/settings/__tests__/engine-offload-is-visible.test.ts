/**
 * @vitest-environment jsdom
 *
 * 3.0.0 leftover, found 2026-09-11: the CPU fallback had no surface.
 *
 * Commit ccdc2d14 gave the engine a second start attempt that drops GPU
 * offload when the first one dies with layers on the card, and a layer count
 * measured against free graphics memory instead of a flat `-ngl 999`. Both
 * worked. Neither could be seen: `start_bundled_engine` answered
 * `cpuOnly: true` in the return value of one call, every caller read `.port`
 * out of that object and threw the rest away, and the layer count lived in the
 * argv and the log file. A user whose card could not hold the model got an
 * engine that looked ordinary, said nothing, and answered at a tenth of the
 * speed.
 *
 * Two surfaces, because the two facts have different lifetimes: the fallback
 * is an event and goes to the standing line above the composer, the layer
 * count is a condition and goes where Settings already names model, context
 * and port.
 *
 * Run: npx vitest run src/components/settings/__tests__/engine-offload-is-visible.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement } from 'react'
import { render, screen, cleanup, act } from '@testing-library/react'

const backendCall = vi.fn()
vi.mock('../../../api/backend', () => ({
  backendCall: (cmd: string, args?: unknown) => backendCall(cmd, args),
  isTauri: () => true,
  isMacOS: () => false,
  isLinux: () => false,
  isWindows: () => false,
  openExternal: vi.fn(),
  secretGet: vi.fn().mockRejectedValue(new Error('no keychain here')),
  secretSet: vi.fn(),
  secretDelete: vi.fn(),
}))

const { engineOffloadLine, announceEngineCpuFallback, ENGINE_CPU_ONLY_NOTE, __resetEngineCpuFallbackNote } =
  await import('../../../lib/engine-offload')
const { bundledEngineStatus } = await import('../../../api/engine')
const { useLuEngineSwitchStore } = await import('../../../stores/luEngineSwitchStore')
const { BuiltinEngineSettings } = await import('../BuiltinEngineSettings')
const { LuEngineSwitchBar } = await import('../../chat/LuEngineSwitchBar')

/** A running engine that took the whole model onto the card. The ordinary one. */
const AUF_DER_KARTE = {
  running: true, healthy: true, port: 8127,
  model_path: '/m/phi.gguf', ctx: 8192, cpuOnly: false, gpuLayers: null,
}

/** The same engine after the GPU attempt died and the retry took the card out. */
const AUF_DEM_PROZESSOR = { ...AUF_DER_KARTE, cpuOnly: true, gpuLayers: 0 }

beforeEach(() => {
  backendCall.mockReset()
  backendCall.mockResolvedValue({})
  __resetEngineCpuFallbackNote()
  useLuEngineSwitchStore.getState().dismiss()
})
afterEach(() => { cleanup(); vi.useRealTimers() })

/** Mount the expert panel over one status answer and read its offload line. */
async function panel(status: unknown): Promise<string | null> {
  backendCall.mockImplementation(async (cmd: string) =>
    cmd === 'bundled_engine_status' ? status : {})
  render(createElement(BuiltinEngineSettings))
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  return screen.queryByTestId('builtin-engine-offload')?.textContent ?? null
}

/** Read one status through the app's own wrapper, then draw the standing line. */
async function standingLine(status: unknown): Promise<HTMLElement | null> {
  backendCall.mockImplementation(async (cmd: string) =>
    cmd === 'bundled_engine_status' ? status : {})
  await act(async () => { await bundledEngineStatus() })
  render(createElement(LuEngineSwitchBar))
  return screen.queryByTestId('lu-engine-switch-note')
}

describe('the line itself', () => {
  it('says the card was taken out, not just that nought layers went on it', () => {
    expect(engineOffloadLine(AUF_DEM_PROZESSOR)).toBe('GPU layers: 0, the GPU start failed')
  })

  it('names a measured layer count', () => {
    expect(engineOffloadLine({ running: true, gpuLayers: 18 })).toBe('GPU layers: 18')
  })

  it('stays silent when every layer was asked for', () => {
    // 999 is llama.cpp's sentinel for "all of them" and Rust withholds it, so
    // this is what an ordinary machine produces and it deserves no line.
    expect(engineOffloadLine(AUF_DER_KARTE)).toBeNull()
    expect(engineOffloadLine({ running: true })).toBeNull()
  })

  it('promises nothing about an engine that is not up', () => {
    expect(engineOffloadLine({ running: false, cpuOnly: true, gpuLayers: 0 })).toBeNull()
    expect(engineOffloadLine(null)).toBeNull()
  })

  // A user who wrote 0 into GPU Layers got what he asked for. Telling him the
  // graphics card failed would be an invention.
  it('does not call a typed zero a failed start', () => {
    expect(engineOffloadLine({ running: true, cpuOnly: false, gpuLayers: 0 })).toBe('GPU layers: 0')
  })
})

describe('Built-in Engine (expert) shows the layer count', () => {
  it('says the engine ended up on the processor', async () => {
    expect(await panel(AUF_DEM_PROZESSOR)).toBe('GPU layers: 0, the GPU start failed')
  })

  it('names the layers a measured start bought', async () => {
    expect(await panel({ ...AUF_DER_KARTE, gpuLayers: 24 })).toBe('GPU layers: 24')
  })

  it('adds no line at all on the ordinary machine', async () => {
    expect(await panel(AUF_DER_KARTE)).toBeNull()
  })
})

describe('the standing line above the composer', () => {
  it('tells the user his engine is on the CPU and where to read why', async () => {
    const line = await standingLine(AUF_DEM_PROZESSOR)
    expect(line?.textContent).toContain(ENGINE_CPU_ONLY_NOTE)
    // Quiet, not red. lib/hinweis.ts: a slower engine that serves is not an
    // error, and this app has exactly two tones.
    expect(line?.getAttribute('data-tone')).toBe('info')
  })

  it('says nothing about an engine that got the card it wanted', async () => {
    expect(await standingLine(AUF_DER_KARTE)).toBeNull()
  })

  it('says it once per engine, not once per poll', async () => {
    await standingLine(AUF_DEM_PROZESSOR)
    useLuEngineSwitchStore.getState().dismiss()
    // Three more polls of the SAME process. A note the user has just closed
    // must not come back three seconds later.
    await act(async () => { await bundledEngineStatus() })
    await act(async () => { await bundledEngineStatus() })
    await act(async () => { await bundledEngineStatus() })
    expect(useLuEngineSwitchStore.getState().note).toBeNull()
  })

  it('speaks again when a new engine falls back', async () => {
    await standingLine(AUF_DEM_PROZESSOR)
    useLuEngineSwitchStore.getState().dismiss()
    backendCall.mockImplementation(async (cmd: string) =>
      cmd === 'bundled_engine_status' ? { ...AUF_DEM_PROZESSOR, model_path: '/m/qwen.gguf' } : {})
    await act(async () => { await bundledEngineStatus() })
    expect(useLuEngineSwitchStore.getState().note).toBe(ENGINE_CPU_ONLY_NOTE)
  })

  it('holds the note back while no view can draw it', async () => {
    // The poll behind Settings is one of the two that reach this code, and
    // Settings does not draw the line. Announcing there on the ordinary clock
    // would spend the whole twelve seconds on a page that cannot show it.
    const { useUIStore } = await import('../../../stores/uiStore')
    useUIStore.setState({ currentView: 'settings' })
    try {
      announceEngineCpuFallback(AUF_DEM_PROZESSOR)
      expect(useLuEngineSwitchStore.getState().note).toBe(ENGINE_CPU_ONLY_NOTE)
      // Still standing after the ordinary clock would have cleared it.
      vi.useFakeTimers()
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
      expect(useLuEngineSwitchStore.getState().note).toBe(ENGINE_CPU_ONLY_NOTE)
    } finally {
      useUIStore.setState({ currentView: 'chat' })
    }
  })
})
