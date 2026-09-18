/**
 * B2 Commit 6: mirror the useChat.ts fix into useCodex.ts, the second copy
 * of the same logic.
 *
 * `runningRef` in useCodex.ts is a single boolean per HOOK INSTANCE, not per
 * run — and CodexView is not remounted on a conversation switch, so one
 * `useCodex()` instance really does serve every Code conversation for the
 * whole window (same premise as the useChat.ts bug, see
 * useChat-zwei-laeufe-vermischen-nicht.test.ts).
 *
 * Three places read or write that shared flag as if it belonged to the ONE
 * run currently in flight:
 *
 *  - The ReAct loop's own iteration guard (`... && runningRef.current && ...`
 *    and `if (!runningRef.current || abort.signal.aborted) break`): if
 *    conversation A finishes (its `finally` sets `runningRef.current = false`)
 *    while conversation B is still mid-loop on the SAME hook instance, B's
 *    very next iteration check reads `false` and B's loop exits early — not
 *    because B was stopped, but because A happened to finish first.
 *  - The `/loop` pass driver's re-entry gate (`if (runningRef.current) {
 *    clear the loop; return }`): meant to defer a pass while ITS OWN
 *    conversation is still busy, it actually fires whenever ANY conversation
 *    on this hook instance is running — so a manual send in conversation A
 *    silently cancels conversation B's scheduled loop pass.
 *
 * Fix: the ReAct loop already carries a per-call `abort` (its own
 * AbortController) and every conversation already has a canonical,
 * per-conversation stop flag (`lib/run-stop.ts`'s `isRunStopped`) — both are
 * genuinely scoped to the right run. The `/loop` gate is rewritten to ask
 * the STORE whether THIS conversation is generating, not the shared ref.
 * `runningRef` itself is retired; nothing correctness-critical should still
 * read it once these three spots stop.
 *
 * This reads the source directly (the same shape as
 * loop-detection.test.ts / useCodex-streaming.test.ts in this same
 * directory): a genuine behavioral repro needs two full ReAct runs
 * interleaved through real tool-call rounds, which the existing behavioral
 * useCodex tests do not attempt either — the wiring pin is what this file's
 * neighbours already rely on for logic this deep in the hook.
 *
 * Run: npx vitest run src/hooks/__tests__/useCodex-lauf-gehoert-seiner-unterhaltung.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const src = readFileSync(join(__dirname, '../useCodex.ts'), 'utf8')

describe('a codex run in useCodex.ts is gated by its OWN state, not a shared hook-instance flag', () => {
  it('runningRef is gone: no other conversation\'s finally can flip this run\'s own loop guard', () => {
    expect(src).not.toMatch(/runningRef/)
  })

  it('the ReAct loop bound checks this run\'s own abort signal and its own conversation\'s stop flag', () => {
    expect(src).toMatch(/for \(let i = 0; i < MAX_CODEX_ITERATIONS && !abort\.signal\.aborted && !isRunStopped\(convId\); i\+\+\)/)
  })

  it('the mid-loop break also reads only this run\'s own signal', () => {
    expect(src).toMatch(/if \(abort\.signal\.aborted \|\| isRunStopped\(convId\)\) break/)
  })

  it('the /loop pass driver defers on ITS OWN conversation generating, not on any conversation running', () => {
    expect(src).toContain("if (useGenerationStore.getState().generating[convForLoop])")
  })
})
