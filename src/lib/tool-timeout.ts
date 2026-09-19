/**
 * One timeout rule for every tool call, shared by useCodex and useAgentChat
 * (audit B8/B9): the two loops used to disagree — Codex raced every call
 * against a generous cap while Agent mode had NO ceiling at all (a hung tool
 * wedged the whole run), and Agent never injected the long shell default, so
 * the same build that passed in the Code tab died at the Rust side's 120 s
 * default in Agent mode.
 *
 * The cap is a BACKSTOP above the tool's own deadline, never the working
 * limit: shell/code/test/git enforce their real timeout in the Rust backend
 * (args.timeout), image/video in the vram-handoff poll
 * (imageGen/videoGenTimeoutMinutes). The JS race only exists so a tool whose
 * own timer never fires cannot hold the loop forever.
 */

/** Default args.timeout the loops inject for the exec tools (ms). Building an
 * app (npm install, cargo/gradle) routinely runs minutes; the old 30 s
 * default + 60 s JS cap killed every real build (David 2026-06-04). */
export const SHELL_EXECUTE_DEFAULT_TIMEOUT_MS = 600_000

const LONG_RUNNING = new Set([
  'shell_execute',
])

/**
 * `setTimeout`'s own practical ceiling: a delay above roughly 24.8 days
 * overflows the 32-bit int it uses internally and fires almost at once
 * instead of never (the opposite of "no cap"). Used below for tools that
 * must not race against a made-up deadline at all.
 */
export const NO_PRACTICAL_CAP_MS = 2_147_483_000

/**
 * `delegate_task` (foreground only) and `run_workflow`: a nested ReAct loop
 * / step chain with its OWN termination, namely iteration and step caps
 * (SUB_AGENT_BUDGET, MAX_STEPS_EXECUTED/MAX_LOOP_ITERATIONS) and Stop wired
 * straight into the run, not a timer this file could ever see (klaerung-n5a,
 * Frage 1). Before this, both fell through to the generic 60 s default,
 * exactly the "actual working limit" this file's own header says the cap
 * must never become, and the measured cause of two real 60,0 s aborts whose
 * sub-agent then kept running, orphaned, holding the local lane. Making that
 * orphaned run actually stop is Fix 2, a separate change to
 * `raceWithToolTimeout` and to the two tools' own executors.
 *
 * `delegate_task`'s BACKGROUND branch is excluded on purpose: it books its
 * own conversation slot under a task id and returns in milliseconds (it
 * never runs inside this race at all in practice), so raising its cap would
 * only hide a real hang instead of a false one.
 *
 * `check_tasks` and `message_agent` were checked too and do NOT belong here:
 * both only read or write the in-memory agentTaskStore, no lane, no I/O, no
 * network, so neither can legitimately run anywhere near 60 s, and the
 * generic default stays their real backstop.
 */
const AGENT_LOOP_TOOLS = new Set(['delegate_task', 'run_workflow'])

export interface ToolTimeoutSettings {
  imageGenTimeoutMinutes?: number
  videoGenTimeoutMinutes?: number
}

/** The JS race ceiling for one tool call, in ms. */
export function toolCallCapMs(
  name: string,
  args: Record<string, unknown> | undefined,
  settings: ToolTimeoutSettings,
): number {
  if (name === 'image_generate') {
    return Math.max(1, Number(settings.imageGenTimeoutMinutes) || 20) * 60_000 + 120_000
  }
  if (name === 'video_generate') {
    return Math.max(1, Number(settings.videoGenTimeoutMinutes) || 60) * 60_000 + 120_000
  }
  if (AGENT_LOOP_TOOLS.has(name) && args?.background !== true) {
    return NO_PRACTICAL_CAP_MS
  }
  if (LONG_RUNNING.has(name)) {
    const own = Number(args?.timeout)
    return Number.isFinite(own) && own > 0 ? own + 15_000 : SHELL_EXECUTE_DEFAULT_TIMEOUT_MS + 15_000
  }
  return 60_000
}

/**
 * Race a tool run against its cap. The timer is CLEARED when the tool wins
 * (audit B10) — the old inline race left every winner's setTimeout parked
 * for up to 615 s with the whole closure alive, times 200 iterations.
 */
export function raceWithToolTimeout(run: Promise<string>, name: string, capMs: number): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<string>((_, reject) => {
    timer = setTimeout(
      // The tool name was passed in by both callers but never used, so every
      // timeout reached the model as an anonymous "Tool execution timed out"
      // — in a parallel batch it could not tell which tool had died.
      () => reject(new Error(`Tool execution timed out: ${name} (${Math.round(capMs / 1000)}s)`)),
      capMs,
    )
  })
  return Promise.race([run, deadline]).finally(() => clearTimeout(timer))
}
