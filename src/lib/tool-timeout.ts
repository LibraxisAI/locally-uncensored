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
 * sub-agent then kept running, orphaned, holding the local lane (see Fix 2
 * in raceWithToolTimeout below).
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
 *
 * Fix 2 (klaerung-n5a, Frage 1): `Promise.race` never cancels its loser, it
 * only stops listening to it. Before this, a timed-out tool call reached the
 * model as an error while the real call underneath ran on, unseen, holding
 * whatever local resource it had booked (a sub-agent's local lane, a
 * workflow's), until it ended on its own: the user-visible "Tool execution
 * timed out" was true about the MESSAGE, not about the machine's state.
 *
 * `run` is now a factory, not an already-started promise: it receives the
 * AbortSignal this function owns, so it can build the call's OWN signal
 * (merged with `baseSignal`, the run's Stop) instead of racing a call that
 * was already wired to something else. On timeout that signal is aborted
 * BEFORE the rejection, so the loser gets exactly the same cancellation
 * path Stop already uses, and, for every tool that honours its signal
 * (shell_execute, and now delegate_task/run_workflow, see sub-agent.ts and
 * builtin-tools.ts), actually winds down and releases what it held.
 */
export function raceWithToolTimeout(
  name: string,
  capMs: number,
  run: (signal: AbortSignal) => Promise<string>,
  baseSignal?: AbortSignal,
): Promise<string> {
  const controller = new AbortController()
  if (baseSignal) {
    if (baseSignal.aborted) controller.abort()
    else baseSignal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<string>((_, reject) => {
    timer = setTimeout(
      () => {
        // Abort BEFORE reject: a listener on the rejection path must see an
        // already-aborted signal, not a race between the two.
        controller.abort()
        // The tool name was passed in by both callers but never used, so every
        // timeout reached the model as an anonymous "Tool execution timed out",
        // and in a parallel batch it could not tell which tool had died.
        reject(new Error(`Tool execution timed out: ${name} (${Math.round(capMs / 1000)}s)`))
      },
      capMs,
    )
  })
  // The tool call is built to resolve, not reject, once it honours the
  // signal (registry.execute() and every builtin executor return an "Error:
  // ..."/"Cancelled: ..." STRING on abort, they do not throw), so the
  // settled-late loser here is a resolved promise nobody reads again, never
  // an unhandled rejection. Tools that DO throw on abort are caught the same
  // way any other tool error already is, inside registry.execute()'s own
  // try/catch, well before this race ever sees it.
  return Promise.race([run(controller.signal), deadline]).finally(() => clearTimeout(timer))
}
