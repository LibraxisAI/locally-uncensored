/* eslint-disable @typescript-eslint/no-explicit-any -- this stub is serialized
   into the browser page and stands in for Tauri's untyped `invoke` bridge; the
   dynamic command args and the `window` globals are `any` by nature. */
/**
 * In-page Tauri bridge mock for the built-in-engine e2e (P3b).
 *
 * Injected with `page.addInitScript` BEFORE the app boots, so
 * `window.__TAURI_INTERNALS__` exists when `isTauri()` (src/api/backend.ts)
 * first runs. Every `invoke()` from `@tauri-apps/api/core` funnels into
 * `__TAURI_INTERNALS__.invoke`, so this router stands in for the whole Rust
 * command surface — no Ollama, no llama-server, no ComfyUI.
 *
 * The interesting part is chat streaming: `proxy_localhost_stream_chunked`
 * receives an `onChunk` Tauri Channel whose `onmessage` the app has already
 * wired to a ReadableStream. We push OpenAI-shaped SSE bytes through it, then
 * an empty chunk (Rust's EOF marker), exactly like the real proxy.
 */

export interface TauriMockOptions {
  /** Assistant text the mocked built-in engine "generates" for the first chat. */
  assistantReply: string
  /** Picker id of the bundled starter model the engine reports as loaded. */
  modelName: string
  /** Shape of the MLX media stack this machine reports. Omit for "set up". */
  mlx?: {
    engineInstalled?: boolean
    videoEngineInstalled?: boolean
    installedImages?: string[]
    installedVideos?: string[]
  }
  /**
   * Which OS the app should believe it is on. `isMacOS()` reads
   * navigator.platform/userAgent, so without this every spec silently inherits
   * the DEV MACHINE's platform — and Mac and Windows disagree about the whole
   * local Create surface (MLX vs ComfyUI). Specs that assert platform
   * behaviour must pin it; the default matches the historical CI target.
   */
  platform?: 'mac' | 'windows'
  /**
   * Deliver `assistantReply` as N separate SSE frames, `replyChunkDelayMs`
   * apart, instead of one. A real engine emits a frame per token, which is what
   * drives the once-per-animation-frame store flush in useChat — the path that
   * caused the 2.6.2 renderer Out of Memory. Omit for the historical
   * single-frame behaviour.
   */
  replyChunks?: number
  /** Gap between streamed frames. Default 0 (same macrotask burst). */
  replyChunkDelayMs?: number
  /**
   * Canned HuggingFace file tree served to `fetch_external` for exactly one
   * repo (the URL resolveHfGgufFiles queries). Lets the sharded-download flow
   * run against a byte-accurate snapshot of the real API with no network.
   */
  hfTree?: { repo: string; entries: Array<{ type: string; path: string; size: number }> }
  /**
   * Scripted agent turns for the Code / Agent ReAct loop. Turn N of the run is
   * answered by entry N; the last entry repeats once the script runs out (so a
   * text-only final entry ends the loop). Without this the mock answers every
   * turn with plain prose, which means the loop stops after one step and no
   * spec can drive the coding agent at all.
   *
   * Tool-call frames go out as OpenAI streaming deltas, the same shape the
   * built-in engine and every openai-compat backend emit, so the provider's
   * own accumulator is what the spec exercises.
   */
  agentTurns?: Array<{
    /** Prose for this turn, streamed as content deltas. */
    text?: string
    /** Tool calls for this turn, streamed as tool_call deltas. */
    toolCalls?: Array<{ name: string; args: Record<string, unknown> }>
  }>
  /** Canned file contents served to fs_read, keyed by path suffix. */
  files?: Record<string, string>

  /**
   * Model names the mocked Ollama reports on /api/tags. Default stays the
   * empty list (fresh box); a spec that needs an ACTIVE Ollama model (the
   * stale-chip surface) seeds one here so modelStore's validation does not
   * drop the persisted activeModel at boot.
   */
  ollamaModels?: string[]

  /**
   * ComfyUI world for Windows specs. Omit for the default: fresh box, no
   * install, nothing running (comfyui_status keeps rejecting either way).
   * `installed` starts the world with a working install at C:\ComfyUI.
   * `installs` feeds the onboarding multi-install picker
   * (detect_all_comfyui_installs; more than one entry shows the picker).
   * `completeFiles` are the model filenames check_model_sizes reports as
   * fully downloaded. `envBroken` makes comfyui_last_output blame a dead
   * venv so the GH #98 self-repair path can be driven; the repair clears it.
   * `startedCpu` is what get_comfy_gpu_status reports once LU has started
   * ComfyUI (drives the CPU-only warning banner).
   */
  comfy?: {
    installed?: boolean
    installs?: Array<{ path: string; complete: boolean; has_embedded_python: boolean; source: string }>
    completeFiles?: string[]
    envBroken?: boolean
    startedCpu?: boolean
  }

  /**
   * System surface: installs, interpreter/git presence, GPUs, store backups.
   * Defaults model a fresh box (nothing external running) that still has
   * Python + git, so the ComfyUI / Codex flows are not blocked by default.
   * Set pythonAvailable: false to drive the Onboarding "install Python"
   * branch through the poll-until-complete slot.
   */
  sys?: {
    /** python_check reports Python present. Default true. */
    pythonAvailable?: boolean
    /** check_git_installed reports git present (Codex banner hidden). Default true. */
    gitInstalled?: boolean
    /** detect_gpus payload. Default: one NVIDIA card from nvidia-smi. */
    gpus?: Array<{
      index: number
      vendor: string
      name: string
      memory_mib: number | null
      source: string
      note?: string | null
    }>
    /** system_info.totalMemory in bytes; also feeds system_health ram_gb. Default 32 GiB. */
    totalMemoryBytes?: number
    /** Pre-seeded restore_stores payload (JSON string). Default null = no backup file. */
    storeBackup?: string | null
    /** Pre-seeded restore_rag_chunks payload (JSON string). Default null. */
    ragBackup?: string | null
  }

// Add to TauriMockOptions:

  /**
   * Trainer world before the spec starts. Omit for "set up" (env ready, base
   * models ready), matching the mlx option convention. A fresh box is
   * `{ envReady: false, basesReady: false }`; the install and the base-model
   * downloads then drive both gates through the real flows.
   */
  trainer?: { envReady?: boolean; basesReady?: boolean }
  /**
   * Voice world. Omit for "nothing installed": no piper package, no voices on
   * disk. This keeps the verdict of every existing spec unchanged, because the
   * old reject-only tts_status case also read as unavailable through the
   * catch in checkTtsAvailable. `transcript` is what `transcribe` returns.
   */
  voice?: { piperInstalled?: boolean; installedVoices?: string[]; transcript?: string }

  /**
   * Connected devices the remote server reports at boot. Rust clears the
   * list on every start_remote_server (fresh dispatch = fresh session), so
   * a spec that asserts the device list or the disconnect trash button
   * seeds here and reads without dispatching first.
   */
  remoteDevices?: Array<{ id: string; ip: string; user_agent: string; last_seen: number }>
  /**
   * Raw callback query oauth_wait resolves with. Default is a provider
   * denial (error=...), which loginWithProvider (api/cloud/supabase.ts)
   * turns into a clean thrown error instead of hanging for the 300 s
   * browser timeout. A spec may pass 'code=...' but the PKCE exchange that
   * follows hits Supabase for real, so success needs network mocking too.
   */
  oauthCallbackQuery?: string

  /**
   * Import candidates list_importable_models reports (GGUFs found in Ollama
   * and LM Studio stores). Default: none, a fresh box has nothing to import.
   */
  importableModels?: Array<{
    name: string
    source: 'ollama' | 'lmstudio'
    path: string
    size: number
    already_imported?: boolean
  }>
  /**
   * Model ids LM Studio reports as loaded at boot. Default: empty. Lets a
   * spec exercise the VRAM handoff evict/reload path without a real LMS.
   */
  lmsLoadedModels?: string[]
}

export const DEFAULT_ASSISTANT_REPLY = 'PONG_BUILTIN_OK the built-in engine answered.'
export const DEFAULT_MODEL_NAME = 'qwen2.5-0.5b-instruct-q4_k_m'

/**
 * The function body below is serialized and runs in the PAGE context — it must
 * be fully self-contained (no imports, no outer closure references except the
 * single `opts` argument Playwright forwards).
 */
export function tauriMockInit(opts: TauriMockOptions) {
  const w = window as any

  // Pin the platform BEFORE the app reads it. isMacOS() (api/backend.ts) tests
  // navigator.platform then userAgent; leaving them alone makes every spec's
  // verdict depend on whose laptop ran it.
  {
    const mac = opts.platform === 'mac'
    const platform = mac ? 'MacIntel' : 'Win32'
    const ua = mac
      ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    try {
      Object.defineProperty(navigator, 'platform', { get: () => platform, configurable: true })
      Object.defineProperty(navigator, 'userAgent', { get: () => ua, configurable: true })
    } catch {
      /* a locked-down navigator just means the host platform wins */
    }
  }

  // Hermetic network: localFetch (api/backend.ts) falls back to a DIRECT
  // browser fetch whenever the proxied invoke rejects. On a developer Mac
  // that fallback can hit a REAL Ollama on 11434, AirPlay on 5000 or any
  // stray dev server, and the spec's verdict starts depending on the host.
  // Seal every localhost request that is not the Vite dev server itself;
  // an instant rejection reads exactly like a refused connection.
  {
    const realFetch = window.fetch.bind(window)
    const devPort = window.location.port
    window.fetch = ((input: any, init?: any) => {
      try {
        const raw = typeof input === 'string' ? input : (input && input.url) || String(input)
        const url = new URL(raw, window.location.href)
        const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)
        if (local && url.port !== devPort) {
          return Promise.reject(new TypeError('Failed to fetch (e2e: localhost sealed)'))
        }
      } catch { /* malformed URL: let the real fetch raise the real error */ }
      return realFetch(input, init)
    }) as any
  }

  const MODELS_DIR = '/tmp/lu-e2e/models'
  const modelFile = `${opts.modelName}.gguf`
  const modelPath = `${MODELS_DIR}/${modelFile}`

  // Filenames whose download the app kicked off — reported "complete" on the
  // very next `download_progress` poll so `awaitDownloadComplete` resolves fast.
  const startedDownloads = new Set<string>()

  // ENG-1 mirror: the ctx the "engine" is currently running with. Every
  // start/swap derives it from the injected tuning (0 = Rust default 8192),
  // and `bundled_engine_status` reports it back — exactly the loop the token
  // counter and the expert panel rely on.
  let engineCtx = 8192

  // ── MLX media surface (macOS local Create) ──────────────────────
  // Mirrors commands/mlx.rs + video.rs closely enough that specs can drive the
  // real install/generate flows. `opts.mlx` decides what the machine looks
  // like before the spec touches anything: a fresh Mac (nothing installed) or
  // a set-up one. Every install completes after MLX_INSTALL_POLLS polls, so a
  // spec can watch the panel go busy → done without arbitrary waits.
  const MLX_INSTALL_POLLS = 2
  const mlxImageCatalog = [
    { id: 'sd-turbo', name: 'SD Turbo', repo: 'stabilityai/sd-turbo', sizeGB: 2.6, minRamGB: 8, steps: 4, guidance: 0, defaultSize: 512, unfiltered: false, description: 'Fast 512px baseline.' },
    { id: 'realistic-vision-v51', name: 'Realistic Vision V5.1', repo: 'SG161222/Realistic_Vision_V5.1_noVAE', sizeGB: 4.4, minRamGB: 8, steps: 25, guidance: 7, defaultSize: 512, unfiltered: true, description: 'Photoreal, unfiltered.' },
  ]
  const mlxVideoCatalog = [
    { id: 'wan21-t2v-1.3b', name: 'Wan 2.1 T2V 1.3B', family: 'wan_2', repo: 'Wan-AI/Wan2.1-T2V-1.3B', sizeGB: 18, minRamGB: 16, defaultFrames: 33, needsConvert: true, unfiltered: true, description: 'Smallest local video model.' },
  ]
  const mlx = {
    engineInstalled: opts.mlx?.engineInstalled ?? true,
    videoEngineInstalled: opts.mlx?.videoEngineInstalled ?? true,
    images: new Set<string>(opts.mlx?.installedImages ?? ['sd-turbo']),
    videos: new Set<string>(opts.mlx?.installedVideos ?? ['wan21-t2v-1.3b']),
  }
  // One install slot per kind, exactly like the Rust side: null means idle
  // (nothing was ever started), a number counts polls since the install began.
  const slot: Record<'image' | 'imageEngine' | 'video' | 'videoEngine', number | null> = {
    image: null,
    imageEngine: null,
    video: null,
    videoEngine: null,
  }
  let pendingImageId: string | null = null
  let pendingVideoId: string | null = null
  // 1x1 transparent PNG — enough for the gallery to render something real.
  const TINY_PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

  function record(bucket: string, entry: any) {
    ;(w[bucket] = w[bucket] || []).push(entry)
  }
  /** Advance an install slot; report 'complete' once it has been polled enough. */
  function installStatus(key: keyof typeof slot, extra?: Record<string, unknown>) {
    const n = slot[key]
    // Rust semantics: a slot nobody started reads 'idle', and polling it does
    // not advance anything. The download tray probes all four slots at boot
    // (adopt), so a mock that advances on read would install engines by
    // merely being looked at.
    if (n === null) {
      return {
        status: 'idle',
        logs: [] as string[],
        error: null,
        download_progress: 0,
        download_total: 0,
        download_speed: 0,
        ...extra,
      }
    }
    slot[key] = n + 1
    const done = n + 1 >= MLX_INSTALL_POLLS
    return {
      status: done ? 'complete' : 'installing',
      logs: done ? ['download complete', 'ready'] : ['starting…', 'downloading…'],
      error: null,
      download_progress: done ? 100 : 40,
      download_total: 100,
      download_speed: 1024 * 1024,
      ...extra,
    }
  }

  const enc = (s: string) => Array.from(new TextEncoder().encode(s))

  // Ordered OpenAI SSE for one assistant turn, ending with [DONE].
  function chatSse(text: string): string {
    const frame = (delta: Record<string, unknown>, finish: string | null) =>
      `data: ${JSON.stringify({
        id: 'chatcmpl-e2e',
        object: 'chat.completion.chunk',
        model: opts.modelName,
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`
    return (
      frame({ role: 'assistant' }, null) +
      frame({ content: text }, null) +
      frame({}, 'stop') +
      'data: [DONE]\n\n'
    )
  }

  /** The same turn, split into `n` deliverable pieces. n=1 reproduces chatSse
   *  byte for byte, so specs that do not opt in are unaffected. */
  function chatSseParts(text: string, n: number): string[] {
    if (n <= 1) return [chatSse(text)]
    const frame = (delta: Record<string, unknown>, finish: string | null) =>
      `data: ${JSON.stringify({
        id: 'chatcmpl-e2e',
        object: 'chat.completion.chunk',
        model: opts.modelName,
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`
    const size = Math.ceil(text.length / n)
    const parts = [frame({ role: 'assistant' }, null)]
    for (let i = 0; i < text.length; i += size) {
      parts.push(frame({ content: text.slice(i, i + size) }, null))
    }
    parts.push(frame({}, 'stop') + 'data: [DONE]\n\n')
    return parts
  }

  /**
   * SSE frames for one scripted agent turn: prose deltas, then tool_call
   * deltas, then the finish frame. Emitting the tool call as DELTAS (id+name
   * first, arguments after) is deliberate — that is what a real backend does,
   * and it is the accumulator in openai-provider that the agent specs need to
   * exercise, not a pre-assembled call.
   */
  function agentTurnSse(turn: { text?: string; toolCalls?: Array<{ name: string; args: any }> }): string[] {
    const frame = (delta: Record<string, unknown>, finish: string | null) =>
      `data: ${JSON.stringify({
        id: 'chatcmpl-e2e',
        object: 'chat.completion.chunk',
        model: opts.modelName,
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`
    const parts = [frame({ role: 'assistant' }, null)]
    const text = turn.text || ''
    const size = Math.max(1, Math.ceil(text.length / 8))
    for (let i = 0; i < text.length; i += size) {
      parts.push(frame({ content: text.slice(i, i + size) }, null))
    }
    const calls = turn.toolCalls || []
    calls.forEach((c, idx) => {
      parts.push(frame({ tool_calls: [{ index: idx, id: `call_e2e_${idx}`, type: 'function', function: { name: c.name, arguments: '' } }] }, null))
      parts.push(frame({ tool_calls: [{ index: idx, function: { arguments: JSON.stringify(c.args ?? {}) } }] }, null))
    })
    parts.push(frame({}, calls.length ? 'tool_calls' : 'stop') + 'data: [DONE]\n\n')
    return parts
  }

  /** Which scripted turn the next model call gets. */
  let agentTurnIndex = 0

  // ComfyUI surface (Windows local Create). Mirrors commands/process.rs +
  // install.rs closely enough to drive the install/start/repair flows.
  // Installs run through the same slot pattern as MLX: null means idle,
  // a number counts status polls, done after COMFY_INSTALL_POLLS.
  const comfyOpts = opts.comfy || {}
  let comfyInstalled = comfyOpts.installed ?? false
  let comfyRunning = false
  let comfyPath = comfyOpts.installs?.[0]?.path ?? 'C:\\ComfyUI'
  let comfyHost = 'localhost'
  let comfyPort = 8188
  // Rust semantics: null until LU itself (re)started ComfyUI this session.
  let comfyStartedCpu: boolean | null = null
  let comfyEnvBroken = comfyOpts.envBroken ?? false
  const comfyCompleteFiles = new Set<string>(comfyOpts.completeFiles ?? [])
  const COMFY_INSTALL_POLLS = 2
  let comfyInstallSlot: number | null = null
  let comfyInstallCancelled = false
  // install / repair / update share one status slot, exactly like Rust's
  // install_status; the kind only picks the final log line and side effect.
  let comfyInstallKind: 'install' | 'repair' | 'update' = 'install'

  /** ComfyUI variant of installStatus: no error field (the real
   *  install_comfyui_status returns exactly these five keys), 'cancelled'
   *  is sticky once the cancel flag was raised, 'complete' is sticky too. */
  function comfyInstallStatus() {
    if (comfyInstallSlot === null) {
      return { status: 'idle', logs: [] as string[], download_progress: 0, download_total: 0, download_speed: 0 }
    }
    if (comfyInstallCancelled) {
      return {
        status: 'cancelled',
        logs: ['Cancellation requested', 'Install cancelled'],
        download_progress: 0,
        download_total: 0,
        download_speed: 0,
      }
    }
    comfyInstallSlot += 1
    const done = comfyInstallSlot >= COMFY_INSTALL_POLLS
    if (done) {
      // Idempotent on repeat polls, so a sticky 'complete' stays harmless.
      if (comfyInstallKind === 'install') comfyInstalled = true
      if (comfyInstallKind === 'repair') comfyEnvBroken = false
      const finalLog =
        comfyInstallKind === 'repair'
          ? 'Environment repaired. ComfyUI now runs from its own venv; start it again.'
          : comfyInstallKind === 'update'
            ? 'ComfyUI updated'
            : 'ComfyUI installed successfully!'
      return {
        status: 'complete',
        logs: ['Downloading PyTorch...', finalLog],
        download_progress: 100,
        download_total: 100,
        download_speed: 1024 * 1024,
      }
    }
    // 'Downloading' in the log is load-bearing: Onboarding gates its
    // progress bar on that substring.
    return {
      status: 'installing',
      logs: ['Starting ComfyUI installation...', 'Downloading PyTorch...'],
      download_progress: 40,
      download_total: 100,
      download_speed: 1024 * 1024,
    }
  }

  // ── system surface (installs, gpu, health, store backups) ─────────
  // Install slots for the external-backend installers, same polling
  // contract as `slot` but a separate object: those four belong to the
  // MLX surface and the semantics (who flips what on 'complete') differ.
  const SYS_INSTALL_POLLS = 2
  const sysInstallSlots: Record<'ollama' | 'lmstudio' | 'python', number | null> = {
    ollama: null,
    lmstudio: null,
    python: null,
  }
  let sysPythonAvailable = opts.sys?.pythonAvailable ?? true
  const sysPythonPath = opts.platform === 'mac' ? '/usr/bin/python3' : 'C:\\Python312\\python.exe'
  const sysGitInstalled = opts.sys?.gitInstalled ?? true
  const sysGpus = opts.sys?.gpus ?? [
    { index: 0, vendor: 'nvidia', name: 'NVIDIA GeForce RTX 4070', memory_mib: 12282, source: 'nvidia-smi', note: null },
  ]
  const sysTotalMemory = opts.sys?.totalMemoryBytes ?? 32 * 1024 * 1024 * 1024
  // Round-trips within the page session: backup_* writes here, restore_* reads.
  let sysStoreBackup: string | null = opts.sys?.storeBackup ?? null
  let sysRagBackup: string | null = opts.sys?.ragBackup ?? null
  /** installStatus twin for the sys slots. Same shape the three Rust status
   *  endpoints serialize: status/logs/download_progress/download_total/
   *  download_speed. Idle reads 'idle' and never advances. */
  function sysInstallStatus(key: keyof typeof sysInstallSlots) {
    const n = sysInstallSlots[key]
    if (n === null) {
      return { status: 'idle', logs: [] as string[], download_progress: 0, download_total: 0, download_speed: 0 }
    }
    sysInstallSlots[key] = n + 1
    const done = n + 1 >= SYS_INSTALL_POLLS
    return {
      status: done ? 'complete' : 'downloading',
      logs: done ? ['Download complete.', 'Ready.'] : ['Downloading installer...'],
      download_progress: done ? 100 : 40,
      download_total: 100,
      download_speed: 1024 * 1024,
    }
  }

  const TRAINER_ROOT = '/tmp/lu-e2e/musubi'
  const TRAINER_POLLS = 2
  const TRAINER_BASE_FILENAMES = ['z_image_bf16.safetensors', 'qwen_3_4b.safetensors', 'ae.safetensors']
  const trainerWorld = {
    envReady: opts.trainer?.envReady ?? true,
    basesReady: opts.trainer?.basesReady ?? true,
  }
  // Mirrors the Rust InstallState (state.rs): status starts as 'idle'. The
  // object persists so a poll AFTER completion still reads 'complete'.
  const trainerInstall = { status: 'idle', logs: [] as string[] }
  // null = no install running, a number counts polls (installStatus pattern).
  let trainerInstallPolls: number | null = null
  const trainerRun = { status: 'idle', phase: '', logs: [] as string[], step: 0, totalSteps: 0 }
  let trainerRunPolls: number | null = null
  let trainerRunName = ''

  const VOICE_POLLS = 2
  const VOICE_DEFAULT_VOICE = 'en_US-lessac-medium'
  const voiceWorld = {
    piper: opts.voice?.piperInstalled ?? false,
    voices: new Set<string>(opts.voice?.installedVoices ?? []),
  }
  let voiceTtsInstallPolls: number | null = null
  const voiceWhisperInstall = { status: 'idle', logs: [] as string[] }
  let voiceWhisperInstallPolls: number | null = null
  // A minimal REAL PCM WAV (16 bit mono 8 kHz, 160 frames of silence).
  // playNeuralAudio falls back through parseWavPcm / Web Audio when the media
  // element cannot play, so the clip has to be a byte-valid wav or every
  // read-aloud spec dies in "neural audio playback failed".
  const voiceTinyWavB64 = (() => {
    const n = 160
    const buf = new ArrayBuffer(44 + n * 2)
    const v = new DataView(buf)
    const str = (o: number, t: string) => {
      for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i))
    }
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ')
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
    v.setUint32(24, 8000, true); v.setUint32(28, 16000, true)
    v.setUint16(32, 2, true); v.setUint16(34, 16, true)
    str(36, 'data'); v.setUint32(40, n * 2, true)
    let bin = ''
    const bytes = new Uint8Array(buf)
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    return btoa(bin)
  })()

  // ── Remote Access server (commands/remote.rs) ───────────────────
  // Small state machine mirroring RemoteServer: stopped by default, start
  // mints a fresh passcode and clears devices, tunnel is off until started.
  const REMOTE_PORT = 11435
  const REMOTE_LAN_IP = '192.168.0.42'
  let remoteRunning = false
  let remotePasscode = ''
  let remotePasscodeExpiresAt = 0
  let remotePasscodeSeq = 0
  let remoteTunnelActive = false
  let remoteTunnelUrl: string | null = null
  let remoteDevices: Array<{ id: string; ip: string; user_agent: string; last_seen: number }> =
    (opts.remoteDevices ?? []).map((d) => ({ ...d }))
  let remotePermissions: any = { filesystem: true, downloads: true, process_control: true, shell: false }
  const nextRemotePasscode = () => {
    remotePasscodeSeq += 1
    remotePasscode = String((remotePasscodeSeq * 111111) % 1000000).padStart(6, '0')
    remotePasscodeExpiresAt = Math.floor(Date.now() / 1000) + 900
    return remotePasscode
  }
  const remoteLanUrl = () => `http://${REMOTE_LAN_IP}:${REMOTE_PORT}`
  const remoteStartResult = () => ({
    port: REMOTE_PORT,
    passcode: remotePasscode,
    passcodeExpiresAt: remotePasscodeExpiresAt,
    lanUrl: remoteLanUrl(),
    mobileUrl: `${remoteLanUrl()}/mobile`,
  })

  // LM Studio loaded set; lmstudio_load_model / lmstudio_unload_model mutate it.
  const lmsLoaded = new Set<string>(opts.lmsLoadedModels ?? [])
  // Handler ids per event name, captured from plugin:event|listen so
  // pull_model_stream can emit real pull-progress events.
  const modelEventListeners: Record<string, number[]> = {}
  // Pulls cancelled via cancel_model_pull; makes the pull promise reject "cancelled".
  const modelPullCancelled = new Set<string>()
  // @tauri-apps/api _unlisten dereferences this plugin global; give it a no-op
  // so unlisten() in pullModelTauri's finally never throws.
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = w.__TAURI_EVENT_PLUGIN_INTERNALS__ || {
    unregisterListener: () => {},
  }

  // Background shell task registry (mirrors the REGISTRY in bg_tasks.rs).
  // A task finishes on its first status poll so specs assert wiring, not
  // patience. Shape matches BgTaskStatus (serde snake_case, no rename).
  let taskSeq = 0
  const taskRegistry: Array<{
    id: string
    command: string
    cwd: string | null
    started_at: number
    finished_at: number | null
    exit_code: number | null
    running: boolean
    cancelled: boolean
    output_tail: string
  }> = []

  function router(cmd: string, args: any): Promise<any> {
    // The MLX wrappers (api/mlx-image.ts invokeMedia) nest their payload under
    // an `args` key to match the Rust `args: Value` signature — unwrap once so
    // the cases below read the fields the caller actually sent.
    const m = args?.args ?? args ?? {}
    switch (cmd) {
      // ── onboarding / lifecycle markers ────────────────────────────
      case 'is_onboarding_done':
        return Promise.resolve(false)
      case 'set_onboarding_done':
        return Promise.resolve(null)

      // ── model dir + download ──────────────────────────────────────
      case 'detect_model_path':
        return Promise.resolve(MODELS_DIR)
      case 'download_model_to_path': {
        const fn = args?.filename
        if (fn) startedDownloads.add(fn)
        // Recorded so specs can assert the exact URLs, target dir and byte
        // sizes a download kicked off with (sharded sets: one call per part).
        record('__E2E_DL_CALLS__', {
          url: args?.url,
          destDir: args?.destDir,
          filename: fn,
          expectedBytes: args?.expectedBytes,
        })
        return Promise.resolve({ status: 'started', id: `dl-${fn}` })
      }
      case 'download_progress': {
        const out: Record<string, any> = {}
        for (const fn of startedDownloads) {
          out[fn] = { progress: 1, total: 1, speed: 0, filename: fn, status: 'complete' }
        }
        return Promise.resolve(out)
      }
      case 'pause_download':
      case 'cancel_download':
      case 'resume_download':
        return Promise.resolve(null)

      // ── built-in engine lifecycle (engine.rs surface) ─────────────
      case 'start_bundled_engine':
      case 'swap_bundled_model': {
        // Record every launch so specs can assert the settings-injected tuning
        // (api/engine.ts merges settings.builtinEngine into each call).
        ;(w.__E2E_ENGINE_CALLS__ = w.__E2E_ENGINE_CALLS__ || []).push({
          cmd,
          modelPath: args?.modelPath,
          tuning: args?.tuning,
        })
        const t = args?.tuning
        engineCtx = t && typeof t.ctx === 'number' && t.ctx > 0 ? t.ctx : 8192
        return Promise.resolve(8127)
      }
      case 'stop_bundled_engine':
        return Promise.resolve(null)
      case 'bundled_engine_status':
        return Promise.resolve({ running: true, healthy: true, port: 8127, model_path: modelPath, ctx: engineCtx })
      case 'list_bundled_models':
        return Promise.resolve({
          dir: MODELS_DIR,
          // ctx_train mirrors the GGUF-header read (ENG-6c) — 32k, like the
          // real Qwen2.5 starter — so specs can assert the preset cap.
          models: [{ name: opts.modelName, path: modelPath, size: 400 * 1024 * 1024, loaded: true, ctx_train: 32768 }],
        })

      // ── built-in EMBEDDINGS server lifecycle (P5) ─────────────────
      case 'start_bundled_embed':
        return Promise.resolve({ status: 'started', port: 8128, model_path: args?.modelPath })
      case 'stop_bundled_embed':
        return Promise.resolve(null)
      case 'bundled_embed_status':
        return Promise.resolve({ running: true, healthy: true, port: 8128, model_path: `${MODELS_DIR}/nomic.gguf` })

      // ── detection: nothing external is running ────────────────────
      case 'get_ollama_host':
        return Promise.resolve('http://localhost:11434')
      case 'lmstudio_model_context':
        // Real Rust returns a shaped object; a null default here trips
        // useActiveContextWindow (`info.loaded`). Return the "unknown" shape.
        return Promise.resolve({ loaded: null, max: null, state: null })
      case 'comfyui_status':
        // Recorded, not just refused: a Mac spec asserts this stays at zero.
        record('__E2E_COMFY_CALLS__', { cmd })
        return Promise.reject('not running (e2e)')
      case 'start_ollama':
      case 'lmstudio_server_status':
      case 'whisper_status':
      case 'install_tts_status':
      case 'search_status':
        return Promise.reject('not running (e2e)')

      // ── MLX image (commands/mlx.rs) ───────────────────────────────
      case 'mlx_status':
        return Promise.resolve({
          installed: mlx.engineInstalled,
          running: mlx.engineInstalled,
          port: 47712,
          modelLoaded: false,
          modelRepo: null,
          idleSeconds: null,
        })
      case 'mlx_start':
        return Promise.resolve({ ok: true, port: 47712 })
      case 'mlx_unload':
        return Promise.resolve({ ok: true, was_loaded: false, running: true })
      case 'mlx_image_models':
        return Promise.resolve(mlxImageCatalog.map((m) => ({ ...m, installed: mlx.images.has(m.id) })))
      // Rust holds the HF token in memory only, so a spec has to be able to
      // see that the frontend pushed it down, not just that it was stored.
      case 'set_hf_token': {
        const token = String(m?.token ?? '').trim()
        w.__E2E_HF_TOKEN__ = token || null
        record('__E2E_MLX_CALLS__', { cmd, present: !!token })
        return Promise.resolve({ ok: true, present: !!token })
      }
      case 'hf_token_present':
        return Promise.resolve({ present: !!w.__E2E_HF_TOKEN__ })
      case 'install_mlx_diffusion':
        slot.imageEngine = 0
        record('__E2E_MLX_CALLS__', { cmd })
        return Promise.resolve({ ok: true, status: 'installing' })
      case 'install_mlx_diffusion_status': {
        const s = installStatus('imageEngine')
        if (s.status === 'complete') mlx.engineInstalled = true
        return Promise.resolve(s)
      }
      case 'mlx_image_install_model':
        slot.image = 0
        pendingImageId = m?.id ?? null
        record('__E2E_MLX_CALLS__', { cmd, id: m?.id })
        return Promise.resolve({ ok: true, status: 'installing', id: m?.id })
      case 'mlx_image_install_status': {
        const s = installStatus('image')
        if (s.status === 'complete' && pendingImageId) {
          mlx.images.add(pendingImageId)
          pendingImageId = null
        }
        return Promise.resolve(s)
      }
      case 'mlx_image_delete_model':
        mlx.images.delete(m?.id)
        record('__E2E_MLX_CALLS__', { cmd, id: m?.id })
        return Promise.resolve({ ok: true, id: m?.id })
      case 'mlx_generate':
        // The whole point of the Mac Create path: image renders come from
        // here, never from a ComfyUI workflow submit.
        record('__E2E_MLX_CALLS__', {
          cmd,
          prompt: m?.prompt,
          model: m?.model,
          steps: m?.steps,
          seed: m?.seed,
          width: m?.width,
          height: m?.height,
        })
        return Promise.resolve({ image_base64: TINY_PNG, width: m?.width ?? 512, height: m?.height ?? 512 })

      // ── MLX video (commands/video.rs) ─────────────────────────────
      case 'video_status':
        return Promise.resolve({
          available: mlx.videoEngineInstalled,
          appleSilicon: true,
          mlxInstalled: mlx.videoEngineInstalled,
          mlxVersion: mlx.videoEngineInstalled ? '0.4.0' : null,
          pythonBin: '/tmp/lu-e2e/venv/bin/python',
          modelsRoot: '/tmp/lu-e2e/mlx-video',
          outputsRoot: '/tmp/lu-e2e/videos',
          installedModels: [...mlx.videos],
          running: false,
        })
      case 'video_list_models':
        return Promise.resolve(mlxVideoCatalog.map((m) => ({ ...m, installed: mlx.videos.has(m.id) })))
      case 'video_install_mlx':
        slot.videoEngine = 0
        record('__E2E_MLX_CALLS__', { cmd })
        return Promise.resolve({ ok: true, status: 'installing' })
      case 'video_install_mlx_status': {
        const s = installStatus('videoEngine')
        if (s.status === 'complete') mlx.videoEngineInstalled = true
        return Promise.resolve(s)
      }
      case 'video_install_model':
        slot.video = 0
        pendingVideoId = m?.id ?? null
        // The payload is nested under `args` (invokeMedia) — reading args.id
        // here recorded undefined and let an id assertion pass on nothing.
        record('__E2E_MLX_CALLS__', { cmd, id: m?.id })
        return Promise.resolve({ ok: true, status: 'installing', id: m?.id })
      case 'video_install_model_status': {
        const s = installStatus('video')
        if (s.status === 'complete' && pendingVideoId) {
          mlx.videos.add(pendingVideoId)
          pendingVideoId = null
        }
        return Promise.resolve(s)
      }
      case 'video_delete_model':
        mlx.videos.delete(m?.id)
        record('__E2E_MLX_CALLS__', { cmd, id: m?.id })
        return Promise.resolve({ ok: true, id: m?.id })
      case 'video_generate':
        record('__E2E_MLX_CALLS__', { cmd, id: m?.id, prompt: m?.prompt, seconds: m?.seconds })
        return Promise.resolve({ ok: true, jobId: 'e2e-vid', pid: 4242, output: '/tmp/lu-e2e/videos/e2e-vid.mp4' })
      case 'video_progress':
        // Completes on the first poll — specs assert the wiring, not patience.
        return Promise.resolve({ running: false, status: 'complete', logs: ['done'], error: null })
      case 'video_cancel':
        record('__E2E_MLX_CALLS__', { cmd })
        return Promise.resolve({ ok: true })
      case 'read_media_file':
        return Promise.resolve(`data:video/mp4;base64,${TINY_PNG}`)

      // ── chat streaming: drive the onChunk Channel ─────────────────
      case 'proxy_localhost_stream_chunked': {
        const channel = args?.onChunk
        const script = opts.agentTurns
        const parts = script && script.length
          ? agentTurnSse(script[Math.min(agentTurnIndex++, script.length - 1)])
          : chatSseParts(opts.assistantReply, opts.replyChunks ?? 1)
        const gap = opts.replyChunkDelayMs ?? 0
        // Deliver on a macrotask so the app's `settled` promise is already
        // being awaited, mirroring the async Rust→WebView channel delivery.
        parts.forEach((part, i) => {
          setTimeout(() => {
            try { channel?.onmessage?.(enc(part)) } catch { /* reader gone */ }
          }, i * gap)
        })
        setTimeout(() => {
          try { channel?.onmessage?.([]) } catch { /* reader gone */ } // empty chunk = EOF
        }, parts.length * gap)
        return Promise.resolve(null)
      }
      case 'proxy_localhost_stream':
        return Promise.resolve(enc(chatSse(opts.assistantReply)))
      case 'cancel_proxy_stream':
        return Promise.resolve(null)

      // ── generic localhost proxy ───────────────────────────────────
      // Ollama's model list (`/api/tags`) must resolve to an EMPTY list so a
      // fresh box looks fresh (existingModelCount === 0 keeps the model picker
      // visible instead of auto-skipping). Resolving here also stops localFetch
      // from falling through to a direct fetch that could hit a REAL Ollama on
      // the dev machine. Every other probe rejects, so no external backend is
      // ever detected as live.
      case 'proxy_localhost': {
        const url: string = args?.url || ''
        // Record every proxied URL so tests can assert routing (e.g. embeddings
        // hit the bundled server on 8128, never Ollama on 11434).
        ;(w.__E2E_PROXY_URLS__ = w.__E2E_PROXY_URLS__ || []).push(url)

        // P5: bundled embeddings server on 8128 speaks OpenAI /v1/embeddings.
        // Echo one deterministic (content-varying) vector per input so the real
        // RAG code (indexDocument / retrieveContext) runs end to end, no Ollama.
        if (url.includes(':8128') || url.includes('/v1/embeddings')) {
          let inputs: string[] = []
          try {
            const parsed = JSON.parse(args?.body || '{}').input
            inputs = Array.isArray(parsed) ? parsed : [parsed]
          } catch { /* empty */ }
          const data = inputs.map((s: string, index: number) => ({
            index,
            embedding: [(s?.length ?? 0) % 7, (s?.charCodeAt(0) || 0) % 13, 1],
          }))
          return Promise.resolve(JSON.stringify({ object: 'list', data, model: 'nomic-embed-text-v1.5' }))
        }

        if (url.includes('11434') || /\/tags(\?|$)/.test(url)) {
          const names = opts.ollamaModels ?? []
          return Promise.resolve(JSON.stringify({
            models: names.map((n) => ({ name: n, model: n, size: 4096, modified_at: '2026-01-01T00:00:00Z' })),
          }))
        }
        return Promise.reject('error sending request: connection refused (e2e)')
      }

      // ── external fetch (HF tree resolve etc.) ────────────────────
      // Serves the canned tree for the one configured repo; every other URL
      // gets JSON null, which callers treat as "API unreachable" and fall
      // back gracefully (resolveHfGgufFiles returns null → guessed file).
      case 'fetch_external': {
        const url: string = args?.url || ''
        const t = opts.hfTree
        if (t && url.includes(`/api/models/${t.repo}/tree/main`)) {
          return Promise.resolve(JSON.stringify(t.entries))
        }
        return Promise.resolve('null')
      }

      // ── LU Cloud keychain session (secret_* → in-memory map) ─────
      // Real keychain semantics: set stores, get returns the stored value
      // (or null), delete removes. Lets the Supabase session survive within
      // a page session and keeps the PKCE verifier separate from it.
      case 'secret_set': {
        ;(w.__E2E_SECRETS__ = w.__E2E_SECRETS__ || {})[args?.account] = args?.value
        return Promise.resolve(null)
      }
      case 'secret_get':
        return Promise.resolve((w.__E2E_SECRETS__ || {})[args?.account] ?? null)
      case 'secret_delete': {
        if (w.__E2E_SECRETS__) delete w.__E2E_SECRETS__[args?.account]
        return Promise.resolve(null)
      }

      // ── agent file/shell tools ────────────────────────────────────
      // Enough of the bridge for the ReAct loop to actually complete a step.
      // Every call is recorded so a spec can assert WHAT the agent ran, which
      // is the only way to prove things like "the second npm test really
      // re-ran after the edit" (audit B1) from the outside.
      case 'fs_read': {
        record('__E2E_TOOL_CALLS__', { cmd, path: m?.path })
        const files = opts.files || {}
        const key = Object.keys(files).find((k) => String(m?.path || '').endsWith(k))
        return Promise.resolve({ content: key ? files[key] : '', encoding: 'utf8' })
      }
      case 'fs_write':
        record('__E2E_TOOL_CALLS__', { cmd, path: m?.path })
        return Promise.resolve({ ok: true, path: m?.path })
      case 'fs_list':
        record('__E2E_TOOL_CALLS__', { cmd, path: m?.path })
        return Promise.resolve({ entries: [] })
      case 'shell_execute':
        record('__E2E_TOOL_CALLS__', { cmd, command: m?.command, timeout: m?.timeout })
        return Promise.resolve({ stdout: 'e2e shell ok', stderr: '', exitCode: 0, timedOut: false })
      case 'repo_map':
        return Promise.resolve({ files: [], count: 0 })

      // ComfyUI install lifecycle (commands/install.rs)
      case 'install_comfyui':
        record('__E2E_COMFY_CALLS__', { cmd, installPath: m?.installPath })
        if (comfyInstallSlot !== null && comfyInstallSlot < COMFY_INSTALL_POLLS && !comfyInstallCancelled) {
          return Promise.resolve({ status: 'already_installing' })
        }
        comfyInstallSlot = 0
        comfyInstallCancelled = false
        comfyInstallKind = 'install'
        return Promise.resolve({ status: 'installing' })
      case 'install_comfyui_status':
        return Promise.resolve(comfyInstallStatus())
      case 'cancel_comfyui_install':
        record('__E2E_COMFY_CALLS__', { cmd })
        // Rust answers 'cancelling' immediately; the status poll flips to
        // 'cancelled' once the worker notices (here: on the next poll).
        if (comfyInstallSlot !== null && comfyInstallSlot < COMFY_INSTALL_POLLS) comfyInstallCancelled = true
        return Promise.resolve({ status: 'cancelling' })
      case 'repair_comfyui_env':
        record('__E2E_COMFY_CALLS__', { cmd })
        if (!comfyInstalled) {
          return Promise.reject('ComfyUI is not installed, so there is no environment to repair. Use Install ComfyUI instead.')
        }
        comfyInstallSlot = 0
        comfyInstallCancelled = false
        comfyInstallKind = 'repair'
        return Promise.resolve({ status: 'installing' })
      case 'update_comfyui':
        record('__E2E_COMFY_CALLS__', { cmd })
        if (!comfyInstalled) return Promise.reject('ComfyUI not found. Install ComfyUI first.')
        comfyInstallSlot = 0
        comfyInstallCancelled = false
        comfyInstallKind = 'update'
        return Promise.resolve({ status: 'installing' })
      case 'install_custom_node':
        // assertNodeInstallOk (api/discover.ts) treats anything but
        // installed/updated as failure.
        record('__E2E_COMFY_CALLS__', { cmd, repoUrl: m?.repoUrl, nodeName: m?.nodeName })
        return Promise.resolve({ status: 'installed', path: `${comfyPath}\\custom_nodes\\${m?.nodeName}` })

      // ComfyUI process lifecycle (commands/process.rs)
      case 'start_comfyui':
        record('__E2E_COMFY_CALLS__', { cmd })
        if (!comfyInstalled) return Promise.reject('ComfyUI not found')
        if (comfyRunning) return Promise.resolve({ status: 'already_running' })
        comfyRunning = true
        comfyStartedCpu = comfyOpts.startedCpu ?? false
        return Promise.resolve({ status: 'started', path: comfyPath })
      case 'stop_comfyui': {
        record('__E2E_COMFY_CALLS__', { cmd })
        const comfyWasRunning = comfyRunning
        comfyRunning = false
        return Promise.resolve({ status: comfyWasRunning ? 'stopped' : 'not_running' })
      }
      case 'comfyui_last_output':
        // exited stays true: nothing can actually run in e2e, so a 'started'
        // ComfyUI reads as crashed on the next poll. That is the world the
        // GH #98 crash surfacing expects, and it makes ensureComfyRunning
        // fail fast instead of sitting out its 60 round port wait.
        return Promise.resolve({
          lines: comfyRunning ? ['ComfyUI e2e stub: nothing runs here', 'process exited (e2e)'] : [],
          exited: true,
          envBroken: comfyEnvBroken,
        })
      case 'get_comfy_gpu_status':
        return Promise.resolve({ mode: 'auto', startedCpu: comfyStartedCpu })
      case 'fix_comfyui_cors':
        record('__E2E_COMFY_CALLS__', { cmd })
        if (!comfyInstalled) {
          return Promise.reject("LU doesn't know this ComfyUI's folder yet. Set it under Settings, AI Backends, ComfyUI, Path, then press the button again.")
        }
        // Rust ends in start_comfyui_blocking, so success looks like a start.
        comfyRunning = true
        return Promise.resolve({ status: 'started', path: comfyPath })

      // ComfyUI detection (commands/process.rs)
      case 'detect_all_comfyui_installs':
        // Serde default casing: has_embedded_python stays snake_case.
        return Promise.resolve(
          comfyOpts.installs
            ?? (comfyInstalled
              ? [{ path: comfyPath, complete: true, has_embedded_python: false, source: 'config.json' }]
              : []),
        )
      case 'find_comfyui':
        return Promise.resolve(
          comfyInstalled
            ? { found: true, path: comfyPath, complete: true }
            : { found: false, path: null, complete: false },
        )

      // ComfyUI settings (commands/process.rs)
      case 'set_comfyui_path':
        // The real command rejects when main.py is missing; the mock accepts
        // any path and treats it as a working install from here on.
        record('__E2E_COMFY_CALLS__', { cmd, path: m?.path })
        comfyPath = String(m?.path ?? '')
        comfyInstalled = true
        return Promise.resolve({ status: 'saved', path: comfyPath })
      case 'set_comfyui_host': {
        const comfyRawHost = String(m?.host ?? '').trim()
        if (!comfyRawHost) return Promise.reject('Host must not be empty')
        if (comfyRawHost.includes('/') || comfyRawHost.includes(' ') || comfyRawHost.includes('?')) {
          return Promise.reject('Host must be a plain hostname or IP, no slashes/spaces')
        }
        // split_host_port: one trailing :port folds into the port; IPv6
        // literals (more than one colon) are left alone.
        const comfyHostMatch = comfyRawHost.match(/^([^:]+):(\d+)$/)
        comfyHost = comfyHostMatch ? comfyHostMatch[1] : comfyRawHost
        if (comfyHostMatch) comfyPort = Number(comfyHostMatch[2])
        const isLocal = ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(comfyHost.toLowerCase())
        record('__E2E_COMFY_CALLS__', { cmd, host: comfyHost })
        return Promise.resolve({ status: 'saved', host: comfyHost, isLocal })
      }
      case 'set_comfyui_port': {
        const comfyNewPort = Number(m?.port)
        if (!comfyNewPort || comfyNewPort <= 0) return Promise.reject('Port must be greater than 0')
        comfyPort = comfyNewPort
        record('__E2E_COMFY_CALLS__', { cmd, port: comfyNewPort })
        return Promise.resolve({ status: 'saved', port: comfyNewPort })
      }

      // ComfyUI models + uploads (commands/download.rs, proxy.rs)
      case 'check_model_sizes': {
        // CheckFileResult serializes camelCase (rename_all in download.rs).
        const comfyCheckFiles: any[] = Array.isArray(m?.files) ? m.files : []
        return Promise.resolve(comfyCheckFiles.map((f: any) => {
          const complete = comfyCompleteFiles.has(f?.filename)
          return {
            filename: f?.filename,
            exists: complete,
            actualBytes: complete ? f?.expectedBytes ?? 0 : 0,
            complete,
          }
        }))
      }
      case 'delete_comfy_model':
        record('__E2E_COMFY_CALLS__', { cmd, filename: m?.filename })
        comfyCompleteFiles.delete(m?.filename)
        return Promise.resolve({ status: 'deleted', bytes: 1024 })
      case 'comfy_upload_image':
        // Rust returns ComfyUI's raw JSON body as a STRING; the caller
        // JSON.parses it and reads .name (api/comfyui.ts uploadImage).
        record('__E2E_COMFY_CALLS__', {
          cmd,
          url: m?.url,
          filename: m?.filename,
          contentType: m?.contentType,
          bytes: Array.isArray(m?.fileBytes) ? m.fileBytes.length : 0,
        })
        return Promise.resolve(JSON.stringify({ name: m?.filename, subfolder: '', type: 'input' }))

      // ComfyUI WS proxy (commands/comfy_ws.rs)
      case 'comfy_ws_connect':
        // Rejection mirrors ws.onerror: useCreate falls back to /history
        // polling. The client schedules backoff retries, so this can record
        // more than once per spec.
        record('__E2E_COMFY_CALLS__', { cmd, clientId: m?.clientId })
        return Promise.reject('ComfyUI WebSocket connect failed: connection refused (e2e)')
      case 'comfy_ws_disconnect':
        record('__E2E_COMFY_CALLS__', { cmd })
        return Promise.resolve(null)

      // ── external-backend installers (commands/install.rs) ─────────
      case 'install_ollama':
        sysInstallSlots.ollama = 0
        record('__E2E_SYS_CALLS__', { cmd })
        return Promise.resolve({ status: 'downloading' })
      case 'install_ollama_status':
        return Promise.resolve(sysInstallStatus('ollama'))
      case 'install_lmstudio':
        sysInstallSlots.lmstudio = 0
        record('__E2E_SYS_CALLS__', { cmd })
        return Promise.resolve({ status: 'downloading' })
      case 'install_lmstudio_status':
        return Promise.resolve(sysInstallStatus('lmstudio'))
      case 'install_python':
        if (sysPythonAvailable) {
          return Promise.resolve({ status: 'already_installed', path: sysPythonPath })
        }
        sysInstallSlots.python = 0
        record('__E2E_SYS_CALLS__', { cmd })
        return Promise.resolve({ status: 'installing' })
      case 'install_python_status': {
        const s = sysInstallStatus('python')
        // Rust re-resolves python_bin when the winget install finishes, so the
        // next python_check flips to available without a restart.
        if (s.status === 'complete') sysPythonAvailable = true
        return Promise.resolve(s)
      }
      case 'python_check':
        return Promise.resolve(
          sysPythonAvailable ? { available: true, path: sysPythonPath } : { available: false, path: null },
        )
      case 'check_git_installed':
        return Promise.resolve(
          sysGitInstalled
            ? {
                installed: true,
                native: true,
                version: 'git version 2.45.0',
                hint: null,
                download_url: 'https://git-scm.com/downloads',
              }
            : {
                installed: false,
                native: false,
                version: null,
                hint: 'Git is not installed or not on PATH. (e2e)',
                download_url: 'https://git-scm.com/downloads',
              },
        )

      // ── hardware (commands/gpu.rs) ────────────────────────────────
      case 'detect_gpus':
        return Promise.resolve(sysGpus)
      case 'set_gpu_selection':
        record('__E2E_SYS_CALLS__', { cmd, selection: m?.selection })
        return Promise.resolve(null)
      case 'set_comfy_gpu_mode': {
        const raw = String(m?.mode ?? '').trim().toLowerCase()
        const mode = raw === 'cpu' || raw === 'gpu' ? raw : 'auto'
        record('__E2E_SYS_CALLS__', { cmd, mode })
        return Promise.resolve({ mode })
      }

      // ── host facts + diagnostics (commands/system.rs, health.rs) ──
      case 'system_info':
        return Promise.resolve({
          os: opts.platform === 'mac' ? 'macos' : 'windows',
          arch: opts.platform === 'mac' ? 'aarch64' : 'x86_64',
          hostname: 'lu-e2e-box',
          username: 'e2e',
          totalMemory: sysTotalMemory,
          cpuCount: 8,
        })
      case 'system_health': {
        // Fresh box: every backend probe reads unreachable, mirroring the
        // proxy_localhost rejects above.
        const down = (endpoint: string) => ({
          status: 'unreachable',
          detail: 'connection refused (e2e)',
          endpoint,
        })
        return Promise.resolve({
          version: '0.0.0-e2e',
          host: {
            os: opts.platform === 'mac' ? 'macos' : 'windows',
            os_version: 'e2e',
            arch: opts.platform === 'mac' ? 'aarch64' : 'x86_64',
            cpu_count: 8,
            ram_gb: Math.round((sysTotalMemory / 1_073_741_824) * 10) / 10,
            disk_free_gb: 100.0,
            vram_total_gb: null,
            vram_free_gb: null,
          },
          ollama: down('http://127.0.0.1:11434/api/tags'),
          comfyui: down('http://127.0.0.1:8188/system_stats'),
          lm_studio: down('http://127.0.0.1:1234/v1/models'),
        })
      }

      // ── window / app lifecycle: record only, never act ────────────
      case 'show_window':
        record('__E2E_SYS_CALLS__', { cmd })
        return Promise.resolve(null)
      case 'exit_app':
        // The real command kills subprocesses and exits the app; doing either
        // would end the Playwright page mid-spec.
        record('__E2E_SYS_CALLS__', { cmd })
        return Promise.resolve(null)

      // ── store backup triad (commands/system.rs) ───────────────────
      // Payloads are kept in state so a restore round-trips; the record only
      // carries the byte count because the triad fires every 5 s and full
      // snapshots would bloat the bucket.
      case 'backup_stores':
        sysStoreBackup = m?.data ?? ''
        record('__E2E_SYS_CALLS__', { cmd, bytes: (m?.data ?? '').length })
        return Promise.resolve(null)
      case 'restore_stores':
        return Promise.resolve(sysStoreBackup)
      case 'backup_rag_chunks':
        sysRagBackup = m?.data ?? ''
        record('__E2E_SYS_CALLS__', { cmd, bytes: (m?.data ?? '').length })
        return Promise.resolve(null)
      case 'restore_rag_chunks':
        return Promise.resolve(sysRagBackup)

      // local character trainer (commands/trainer.rs)
      case 'install_character_trainer': {
        record('__E2E_TRAINER_CALLS__', { cmd, installPath: m?.installPath ?? null })
        if (trainerInstallPolls !== null) return Promise.resolve({ status: 'already_installing' })
        trainerInstallPolls = 0
        trainerInstall.status = 'installing'
        trainerInstall.logs = ['Setting up the local character trainer...']
        return Promise.resolve({ status: 'installing' })
      }
      case 'character_trainer_status': {
        // The install slot advances here: the UI polls this command while the
        // Set up button is busy, there is no separate status command.
        if (trainerInstallPolls !== null) {
          trainerInstallPolls += 1
          if (trainerInstallPolls >= TRAINER_POLLS) {
            trainerInstallPolls = null
            trainerWorld.envReady = true
            trainerInstall.status = 'complete'
            trainerInstall.logs.push('Trainer environment ready.')
          } else {
            trainerInstall.logs.push('Setting up the trainer (3/4): installing PyTorch into the trainer venv...')
          }
        }
        // Bases also count as ready once all three base downloads were kicked
        // off, so the real download flow (download_model_to_path) drives the
        // second gate exactly like on a real box.
        const basesReady = trainerWorld.basesReady
          || TRAINER_BASE_FILENAMES.every((f) => startedDownloads.has(f))
        return Promise.resolve({
          envReady: trainerWorld.envReady,
          basesReady,
          dit: basesReady ? `${TRAINER_ROOT}/models/z_image_bf16.safetensors` : null,
          textEncoder: basesReady ? `${TRAINER_ROOT}/models/qwen_3_4b.safetensors` : null,
          vae: basesReady ? `${TRAINER_ROOT}/models/ae.safetensors` : null,
          root: TRAINER_ROOT,
          install: { status: trainerInstall.status, logs: trainerInstall.logs },
        })
      }
      case 'stage_training_image': {
        record('__E2E_TRAINER_CALLS__', {
          cmd,
          setId: m?.setId,
          filename: m?.filename,
          byteCount: Array.isArray(m?.fileBytes) ? m.fileBytes.length : 0,
          caption: m?.caption,
        })
        return Promise.resolve({ staged: m?.filename })
      }
      case 'clear_training_set': {
        record('__E2E_TRAINER_CALLS__', { cmd, setId: m?.setId })
        return Promise.resolve(null)
      }
      case 'start_character_training': {
        record('__E2E_TRAINER_CALLS__', {
          cmd,
          setId: m?.setId,
          name: m?.name,
          triggerWord: m?.triggerWord,
          steps: m?.steps ?? null,
        })
        if (trainerRun.status === 'running') return Promise.resolve({ status: 'already_running' })
        trainerRunPolls = 0
        trainerRunName = String(m?.name ?? 'char')
        trainerRun.status = 'running'
        trainerRun.phase = 'Preparing the training run...'
        trainerRun.logs = ['Preparing the training run...']
        trainerRun.step = 0
        trainerRun.totalSteps = Math.min(4000, Math.max(100, Number(m?.steps) || 1200))
        return Promise.resolve({ status: 'running' })
      }
      case 'character_training_status': {
        if (trainerRunPolls !== null && trainerRun.status === 'running') {
          trainerRunPolls += 1
          if (trainerRunPolls >= TRAINER_POLLS) {
            trainerRunPolls = null
            trainerRun.status = 'complete'
            trainerRun.step = trainerRun.totalSteps
            trainerRun.phase = `Character ready: char_${trainerRunName}_zimage.safetensors is in your loras.`
            trainerRun.logs.push(trainerRun.phase)
          } else {
            trainerRun.step = Math.floor(trainerRun.totalSteps / 2)
            trainerRun.phase = `Step 3/4: Training (${trainerRun.totalSteps} steps). This runs for a while, live log below...`
            trainerRun.logs.push(`steps: 50%| ${trainerRun.step}/${trainerRun.totalSteps}`)
          }
        }
        return Promise.resolve({
          status: trainerRun.status,
          phase: trainerRun.phase,
          logs: trainerRun.logs.slice(-30),
          step: trainerRun.step,
          totalSteps: trainerRun.totalSteps,
        })
      }
      case 'cancel_character_training': {
        record('__E2E_TRAINER_CALLS__', { cmd })
        if (trainerRun.status === 'running') {
          trainerRunPolls = null
          trainerRun.status = 'cancelled'
          trainerRun.phase = 'cancelled'
          trainerRun.logs.push('cancelled')
        }
        return Promise.resolve(null)
      }

      // voice: piper TTS + whisper STT (commands/tts.rs, whisper.rs, install.rs)
      case 'tts_status': {
        // The TTS install slot advances here, NOT in install_tts_status: that
        // case keeps its historical reject, so the availability probe is the
        // only poll that can move an install to done in the mock.
        if (voiceTtsInstallPolls !== null) {
          voiceTtsInstallPolls += 1
          if (voiceTtsInstallPolls >= VOICE_POLLS) {
            voiceTtsInstallPolls = null
            voiceWorld.piper = true
            voiceWorld.voices.add(VOICE_DEFAULT_VOICE)
          }
        }
        const v = typeof m?.voice === 'string' && m.voice ? m.voice : null
        const voiceReady = v ? voiceWorld.voices.has(v) : voiceWorld.voices.size > 0
        return Promise.resolve({
          available: voiceWorld.piper && voiceReady,
          piper: voiceWorld.piper,
          voice: voiceReady,
        })
      }
      case 'installed_piper_voices':
        return Promise.resolve([...voiceWorld.voices])
      case 'download_voice': {
        record('__E2E_VOICE_CALLS__', { cmd, voice: m?.voice })
        voiceWorld.voices.add(String(m?.voice ?? ''))
        return Promise.resolve({ ok: true, voice: m?.voice })
      }
      case 'synthesize': {
        record('__E2E_VOICE_CALLS__', { cmd, text: m?.text, voice: m?.voice ?? null })
        const v = typeof m?.voice === 'string' && m.voice ? m.voice : VOICE_DEFAULT_VOICE
        if (!voiceWorld.piper || !voiceWorld.voices.has(v)) {
          // Same error head as tts.rs so the fallback chain in useVoice sees
          // the shape it would see on a real box.
          return Promise.reject(`no_voice: the '${v}' voice isn't downloaded (e2e)`)
        }
        return Promise.resolve({ audio_base64: voiceTinyWavB64, mime: 'audio/wav' })
      }
      case 'synthesize_external': {
        record('__E2E_VOICE_CALLS__', { cmd, text: m?.text, url: m?.url, voice: m?.voice ?? null })
        return Promise.resolve({ audio_base64: voiceTinyWavB64, mime: 'audio/wav' })
      }
      case 'transcribe': {
        record('__E2E_VOICE_CALLS__', {
          cmd,
          contentType: m?.contentType,
          audioBase64Length: typeof m?.audioBase64 === 'string' ? m.audioBase64.length : 0,
        })
        return Promise.resolve({
          transcript: opts.voice?.transcript ?? 'e2e transcript ok',
          language: 'en',
        })
      }
      case 'install_tts': {
        record('__E2E_VOICE_CALLS__', { cmd })
        if (voiceTtsInstallPolls !== null) return Promise.resolve({ status: 'already_installing' })
        voiceTtsInstallPolls = 0
        return Promise.resolve({ status: 'installing' })
      }
      case 'install_whisper': {
        record('__E2E_VOICE_CALLS__', { cmd })
        if (voiceWhisperInstallPolls !== null) return Promise.resolve({ status: 'already_installing' })
        voiceWhisperInstallPolls = 0
        voiceWhisperInstall.status = 'installing'
        voiceWhisperInstall.logs = ['Starting faster-whisper installation...']
        return Promise.resolve({ status: 'installing' })
      }
      case 'install_whisper_status': {
        if (voiceWhisperInstallPolls !== null) {
          voiceWhisperInstallPolls += 1
          if (voiceWhisperInstallPolls >= VOICE_POLLS) {
            voiceWhisperInstallPolls = null
            voiceWhisperInstall.status = 'complete'
            voiceWhisperInstall.logs.push('Speech-to-text is ready.')
          } else {
            voiceWhisperInstall.logs.push('Installing faster-whisper (this can take a few minutes)...')
          }
        }
        return Promise.resolve({
          status: voiceWhisperInstall.status,
          logs: voiceWhisperInstall.logs,
          error: voiceWhisperInstall.status === 'error'
            ? voiceWhisperInstall.logs[voiceWhisperInstall.logs.length - 1]
            : null,
          download_progress: 0,
          download_total: 0,
          download_speed: 0,
        })
      }

      // ── Remote Access server (commands/remote.rs) ─────────────────
      case 'start_remote_server': {
        record('__E2E_REMOTE_CALLS__', {
          cmd,
          model: m?.model,
          systemPrompt: m?.systemPrompt,
          backendKind: m?.backendKind,
          backendBase: m?.backendBase,
          backendKey: m?.backendKey,
        })
        if (remoteRunning) return Promise.reject('Remote server already running')
        remoteRunning = true
        nextRemotePasscode()
        // Fresh dispatch = fresh session: Rust clears stale device entries.
        remoteDevices = []
        return Promise.resolve(remoteStartResult())
      }
      case 'restart_remote_server': {
        record('__E2E_REMOTE_CALLS__', {
          cmd,
          model: m?.model,
          systemPrompt: m?.systemPrompt,
          backendKind: m?.backendKind,
          backendBase: m?.backendBase,
          backendKey: m?.backendKey,
        })
        // Rust: stop (kills tunnel too), then start with a new passcode.
        remoteTunnelActive = false
        remoteTunnelUrl = null
        remoteRunning = true
        nextRemotePasscode()
        remoteDevices = []
        return Promise.resolve(remoteStartResult())
      }
      case 'stop_remote_server': {
        record('__E2E_REMOTE_CALLS__', { cmd })
        remoteRunning = false
        remoteTunnelActive = false
        remoteTunnelUrl = null
        return Promise.resolve(null)
      }
      case 'remote_server_status':
        return Promise.resolve({
          running: remoteRunning,
          port: REMOTE_PORT,
          passcode: remoteRunning ? remotePasscode : '',
          passcodeExpiresAt: remoteRunning ? remotePasscodeExpiresAt : 0,
          lanUrl: remoteRunning ? remoteLanUrl() : '',
          mobileUrl: remoteRunning ? `${remoteLanUrl()}/mobile` : '',
          tunnelActive: remoteTunnelActive,
          tunnelUrl: remoteTunnelUrl ?? '',
        })
      case 'regenerate_remote_token': {
        // Rust rotates the passcode only, never the JWT secret (Bug #7).
        record('__E2E_REMOTE_CALLS__', { cmd })
        return Promise.resolve(nextRemotePasscode())
      }
      case 'remote_qr_code': {
        if (!remoteRunning) return Promise.reject('Remote server not running')
        const url = remoteTunnelUrl ? `${remoteTunnelUrl}/mobile` : `${remoteLanUrl()}/mobile`
        record('__E2E_REMOTE_CALLS__', { cmd, url })
        // Raw base64, no data: prefix; the Sidebar img adds it.
        return Promise.resolve({ qr_png_base64: TINY_PNG, url, passcode: remotePasscode })
      }
      case 'remote_connected_devices':
        return Promise.resolve(remoteDevices.map((d) => ({ ...d })))
      case 'disconnect_remote_device': {
        record('__E2E_REMOTE_CALLS__', { cmd, deviceId: m?.deviceId })
        remoteDevices = remoteDevices.filter((d) => d.id !== m?.deviceId)
        return Promise.resolve(null)
      }
      case 'set_remote_permissions': {
        // Desktop command replaces the whole struct, shell included.
        record('__E2E_REMOTE_CALLS__', { cmd, permissions: m?.permissions })
        remotePermissions = { shell: false, ...(m?.permissions ?? {}) }
        void remotePermissions
        return Promise.resolve(null)
      }
      case 'start_tunnel': {
        record('__E2E_REMOTE_CALLS__', { cmd })
        if (!remoteRunning) return Promise.reject('Remote server not running. Start it first.')
        remoteTunnelActive = true
        remoteTunnelUrl = 'https://e2e-mock.trycloudflare.com'
        // Rust returns the bare public URL string.
        return Promise.resolve(remoteTunnelUrl)
      }
      case 'stop_tunnel': {
        record('__E2E_REMOTE_CALLS__', { cmd })
        remoteTunnelActive = false
        remoteTunnelUrl = null
        return Promise.resolve(null)
      }
      case 'set_chat_workspace_override':
        record('__E2E_REMOTE_CALLS__', { cmd, chatId: m?.chatId, path: m?.path ?? null })
        return Promise.resolve(null)

      // ── OAuth loopback (commands/oauth.rs) ────────────────────────
      case 'oauth_start':
        record('__E2E_REMOTE_CALLS__', { cmd })
        // First rung of the fixed port ladder.
        return Promise.resolve(17872)
      case 'oauth_wait': {
        record('__E2E_REMOTE_CALLS__', { cmd, port: m?.port, timeoutSecs: m?.timeoutSecs })
        // Resolve immediately with a raw callback query so the login flow
        // never parks on the 300 s browser timeout. The default denial is
        // handled by loginWithProvider as a clean thrown error.
        const query =
          opts.oauthCallbackQuery ?? 'error=access_denied&error_description=oauth+disabled+in+e2e'
        return Promise.resolve(query)
      }

      // ── Tauri event plugin: track listeners so commands can emit ──
      case 'plugin:event|listen': {
        const ev = String(args?.event || '')
        ;(modelEventListeners[ev] = modelEventListeners[ev] || []).push(args?.handler)
        // Real plugin resolves the event id; the handler id serves as one here.
        return Promise.resolve(args?.handler)
      }
      case 'plugin:event|unlisten': {
        const ev = String(args?.event || '')
        modelEventListeners[ev] = (modelEventListeners[ev] || []).filter((id) => id !== args?.eventId)
        return Promise.resolve(null)
      }

      // ── Ollama pull (proxy.rs): events, not a Channel ─────────────
      case 'pull_model_stream': {
        const name = m?.name
        record('__E2E_MODEL_CALLS__', { cmd, name })
        modelPullCancelled.delete(name)
        const emit = (data: Record<string, unknown>) => {
          for (const id of modelEventListeners['pull-progress'] || []) {
            try {
              // Same envelope Rust emits: a JSON STRING payload {model, data}.
              w[`_${id}`]?.({ event: 'pull-progress', id, payload: JSON.stringify({ model: name, data }) })
            } catch { /* listener gone */ }
          }
        }
        const steps = [
          { status: 'pulling manifest' },
          { status: 'downloading', digest: 'sha256:e2e', total: 100, completed: 50 },
          { status: 'downloading', digest: 'sha256:e2e', total: 100, completed: 100 },
          { status: 'verifying sha256 digest' },
          { status: 'success' },
        ]
        return new Promise((resolve, reject) => {
          steps.forEach((s, i) => {
            setTimeout(() => {
              if (!modelPullCancelled.has(name)) emit(s)
            }, i * 10)
          })
          setTimeout(() => {
            if (modelPullCancelled.has(name)) reject('cancelled')
            else resolve(null)
          }, steps.length * 10)
        })
      }
      case 'cancel_model_pull':
        record('__E2E_MODEL_CALLS__', { cmd, name: m?.name })
        modelPullCancelled.add(m?.name)
        // Rust returns Ok(()) even when nothing is in flight.
        return Promise.resolve(null)

      // ── ComfyUI model download (download.rs) ──────────────────────
      case 'download_model': {
        const fn = m?.filename
        if (fn) startedDownloads.add(fn)
        record('__E2E_MODEL_CALLS__', {
          cmd,
          url: m?.url,
          subfolder: m?.subfolder,
          filename: fn,
          expectedBytes: m?.expectedBytes,
        })
        return Promise.resolve({ status: 'started', id: fn })
      }

      // ── GGUF import into the built-in engine (engine.rs) ──────────
      case 'list_importable_models':
        return Promise.resolve({
          candidates: (opts.importableModels ?? []).map((c) => ({
            already_imported: false,
            ...c,
          })),
        })
      case 'import_local_model': {
        record('__E2E_MODEL_CALLS__', { cmd, path: m?.path, name: m?.name })
        const base = String(m?.name || 'model')
        const file = base.toLowerCase().endsWith('.gguf') ? base : `${base}.gguf`
        return Promise.resolve({ path: `${MODELS_DIR}/${file}` })
      }

      // ── LM Studio load/unload (install.rs) ────────────────────────
      case 'lmstudio_list_loaded':
        return Promise.resolve({ loaded: [...lmsLoaded] })
      case 'lmstudio_load_model':
        record('__E2E_MODEL_CALLS__', { cmd, model: m?.model, contextLength: m?.contextLength ?? null })
        lmsLoaded.add(m?.model)
        return Promise.resolve({ ok: true, model: m?.model, contextLength: m?.contextLength ?? null })
      case 'lmstudio_unload_model': {
        const model = m?.model
        record('__E2E_MODEL_CALLS__', { cmd, model })
        if (model === '--all') lmsLoaded.clear()
        else lmsLoaded.delete(model)
        return Promise.resolve({ ok: true, model })
      }
      case 'start_lmstudio_server':
        record('__E2E_MODEL_CALLS__', { cmd })
        // Default machine has no LM Studio; the Rust not-installed error, verbatim.
        return Promise.reject(
          'LM Studio is not installed (no lms.exe found). Use Settings → Install LM Studio first.'
        )

      // ── VRAM housekeeping (process.rs / engine.rs) ────────────────
      case 'offload_local_models':
        record('__E2E_MODEL_CALLS__', { cmd, includeComfyui: m?.includeComfyui ?? null })
        // Nothing external is resident on this box.
        return Promise.resolve({ offloaded: [] })
      case 'kv_slot_action':
        record('__E2E_MODEL_CALLS__', { cmd, port: m?.port, action: m?.action })
        // ok:true drives the full save/restore handoff path (GH #85).
        return Promise.resolve({ ok: true, body: {} })

      // ── proxy host config (proxy.rs / process.rs) ─────────────────
      case 'register_openai_host':
        record('__E2E_MODEL_CALLS__', { cmd, host: m?.host })
        return Promise.resolve(null)
      case 'set_ollama_host': {
        const raw = String(m?.host ?? '').trim().replace(/\/+$/, '')
        const base = /^https?:\/\//.test(raw) ? raw : `http://${raw}`
        const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[?::1\]?|0\.0\.0\.0)(:|$)/.test(base)
        record('__E2E_MODEL_CALLS__', { cmd, host: m?.host, base })
        return Promise.resolve({ status: 'saved', base, isLocal })
      }
      case 'fetch_external_bytes':
        record('__E2E_MODEL_CALLS__', { cmd, url: m?.url })
        // Vec<u8> crosses the bridge as number[]; caller wraps it in Uint8Array.
        return Promise.resolve(enc('e2e-external-bytes'))

      // ── agent tools (builtin-tools.ts executors) ─────────────────
      case 'execute_code':
        record('__E2E_TOOL_CALLS__', { cmd, code: m?.code, timeout: m?.timeout })
        return Promise.resolve({ stdout: 'e2e python ok', stderr: '', exitCode: 0, timedOut: false })
      case 'fs_search':
        record('__E2E_TOOL_CALLS__', { cmd, path: m?.path, pattern: m?.pattern, maxResults: m?.max_results })
        return Promise.resolve({
          results: [{ file: '/tmp/lu-e2e/workspace/README.md', matches: [{ line: 1, text: 'e2e match' }] }],
          count: 1,
        })
      case 'get_current_time':
        record('__E2E_TOOL_CALLS__', { cmd })
        return Promise.resolve({
          unix: 1767355200,
          iso_local: '2026-01-02 12:00:00',
          iso_utc: '2026-01-02T12:00:00Z',
          timezone: '+0000',
          timezone_offset: 0,
        })
      case 'process_list':
        record('__E2E_TOOL_CALLS__', { cmd })
        return Promise.resolve({
          processes: [
            { name: 'lu-e2e', pid: 4242, memory: 128 * 1024 * 1024, cpu: 1.5 },
            { name: 'node', pid: 4243, memory: 64 * 1024 * 1024, cpu: 0.5 },
          ],
          count: 2,
        })
      case 'screenshot':
        record('__E2E_TOOL_CALLS__', { cmd })
        return Promise.resolve({ image: TINY_PNG, format: 'png', encoding: 'base64' })
      case 'web_fetch':
        record('__E2E_TOOL_CALLS__', { cmd, url: m?.url })
        return Promise.resolve({
          url: m?.url ?? '',
          status: 200,
          contentType: 'text/html; charset=utf-8',
          title: 'E2E Fixture Page',
          text: 'E2E_FETCH_BODY canned page text for the agent.',
          truncated: false,
        })
      case 'web_search':
        record('__E2E_TOOL_CALLS__', { cmd, query: m?.query, count: m?.count, provider: m?.provider })
        return Promise.resolve({
          results: [
            { title: 'E2E Search Result', url: 'https://example.com/e2e', snippet: 'E2E_SEARCH_SNIPPET canned result.' },
          ],
          provider: 'searxng',
        })

      // ── background shell tasks (bg_tasks.rs) ─────────────────────
      // Payloads arrive nested under `args` (bg-tasks.ts wraps every call
      // because the Rust side takes a single `args: Value`), so `m` already
      // holds the inner fields.
      case 'shell_task_start': {
        record('__E2E_TOOL_CALLS__', { cmd, command: m?.command, cwd: m?.cwd })
        if (!String(m?.command ?? '').trim()) return Promise.reject('command is empty')
        const id = `e2e-task-${++taskSeq}`
        taskRegistry.push({
          id,
          command: String(m?.command),
          cwd: m?.cwd ?? '/tmp/lu-e2e/workspace',
          started_at: Math.floor(Date.now() / 1000),
          finished_at: null,
          exit_code: null,
          running: true,
          cancelled: false,
          output_tail: '',
        })
        return Promise.resolve({ id })
      }
      case 'shell_task_status': {
        record('__E2E_TOOL_CALLS__', { cmd, id: m?.id })
        const t = taskRegistry.find((x) => x.id === m?.id)
        if (!t) return Promise.reject(`task not found: ${m?.id}`)
        if (t.running) {
          t.running = false
          t.exit_code = 0
          t.finished_at = Math.floor(Date.now() / 1000)
          t.output_tail = 'e2e task ok\n'
        }
        return Promise.resolve({ ...t })
      }
      case 'shell_task_kill': {
        record('__E2E_TOOL_CALLS__', { cmd, id: m?.id })
        const t = taskRegistry.find((x) => x.id === m?.id)
        if (!t) return Promise.reject(`task not found: ${m?.id}`)
        if (!t.running) return Promise.resolve({ ok: true, cancelled: false, reason: 'already finished' })
        t.running = false
        t.cancelled = true
        t.finished_at = Math.floor(Date.now() / 1000)
        return Promise.resolve({ ok: true, cancelled: true })
      }
      case 'shell_task_list':
        record('__E2E_TOOL_CALLS__', { cmd })
        // Rust sorts newest first.
        return Promise.resolve({ tasks: [...taskRegistry].reverse() })

      // ── native dialogs (system.rs / filesystem.rs) ────────────────
      case 'pick_folder':
        // Returns the chosen path as a STRING or null on cancel, never an
        // object (AgentWorkspaceDialog.tsx relies on that).
        record('__E2E_DIALOG_CALLS__', { cmd, defaultPath: m?.defaultPath ?? null })
        return Promise.resolve('/tmp/lu-e2e/workspace')
      case 'save_text_file_dialog': {
        const name = m?.defaultName ?? 'export.txt'
        record('__E2E_DIALOG_CALLS__', {
          cmd,
          defaultName: name,
          extension: m?.extension,
          bytes: String(m?.content ?? '').length,
        })
        // Chosen path string; null would mean the user cancelled.
        return Promise.resolve(`/tmp/lu-e2e/saved/${name}`)
      }
      case 'save_binary_file_dialog': {
        const name = m?.defaultName ?? 'download.bin'
        record('__E2E_DIALOG_CALLS__', {
          cmd,
          defaultName: name,
          extension: m?.extension,
          bytes: Array.isArray(m?.bytes) ? m.bytes.length : 0,
        })
        return Promise.resolve(`/tmp/lu-e2e/saved/${name}`)
      }

      // ── waitlist (waitlist.rs) ────────────────────────────────────
      case 'waitlist_submit':
        // Rust returns Result<(), String>: Ok(()) crosses the IPC as null.
        record('__E2E_WAITLIST_CALLS__', { cmd, email: m?.email, source: m?.source, version: m?.version })
        return Promise.resolve(null)

      default:
        // Record system-browser opens so specs can assert redirect targets
        // (pricing CTA, closed-beta link) without leaving the page.
        if (cmd === 'plugin:shell|open') {
          ;(w.__E2E_OPENED_URLS__ = w.__E2E_OPENED_URLS__ || []).push(args?.path)
          return Promise.resolve(null)
        }
        // Tauri plugin channels (event listen/unlisten, window, etc.) and any
        // unmodeled command: resolve benignly so nothing throws on boot.
        if (cmd.startsWith('plugin:')) return Promise.resolve(0)
        return Promise.resolve(null)
    }
  }

  let callbackId = 0
  const callbacks: Record<number, (v: any) => void> = {}

  w.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { label: 'main' },
    },
    // Channel/event construction routes through here.
    transformCallback(cb: (v: any) => void) {
      const id = ++callbackId
      callbacks[id] = cb
      w[`_${id}`] = cb
      return id
    },
    unregisterCallback(id: number) {
      delete callbacks[id]
      delete w[`_${id}`]
    },
    convertFileSrc(path: string) {
      return path
    },
    invoke(cmd: string, args: any) {
      return router(cmd, args)
    },
  }
  // Legacy v1 alias some detection code still probes for.
  w.__TAURI__ = w.__TAURI_INTERNALS__
}
