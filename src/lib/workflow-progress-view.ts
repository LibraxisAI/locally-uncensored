/**
 * Pure rendering for the workflow-progress ToolCallBlock (bau/wfprogress.md).
 *
 * klein 2 (Zusatz vom Eigner, 20.09.2026): the running workflow must be
 * clickable and expand DOWNWARD exactly like a real tool call, and the
 * expanded view must show every step (waiting/running/done/failed), each
 * finished step's truncated result (args + result for a tool step, the start
 * of the model's answer for a prompt step), and the currently running step's
 * live text. This module builds that text; the caller (useAgentChat.ts) only
 * has to keep a `WorkflowStepView[]` current and hand it to
 * `renderWorkflowStepList`, which becomes the SAME `AgentToolCall.result` a
 * real tool call already renders in its collapsible details pane — no new
 * component, no new expand pattern.
 *
 * Kept a separate leaf module (no React, no store) so the step-list text and
 * its truncation are unit-testable without mounting a hook.
 */

import type { StepStatus, WorkflowStep } from '../types/agent-workflows'

export interface WorkflowStepView {
  step: WorkflowStep
  status: StepStatus
  /** Tool-step args (from `StepResult.toolCalls[0].args`), when known. */
  args?: Record<string, unknown>
  /** Step output — the model's answer for a prompt step, or the tool
   *  result for a tool step. Updated LIVE while a prompt step streams
   *  (`onStepProgress`), then finalised on completion. */
  output?: string
  error?: string
}

/**
 * Long tool output already gets a head+tail truncation for the MODEL's own
 * context (`truncateToolResult`, lib/truncate-tool-result.ts). This is a
 * separate, much smaller budget for the CHAT TRANSCRIPT's own display only —
 * "lange Ausgaben kuerzen, damit der Chat nicht explodiert, und nichts davon
 * zusaetzlich in den Modellkontext schieben" (the Eigner's own wording): this
 * value never reaches a prompt, so it stays independent of the model-facing
 * caps in truncate-tool-result.ts. 400 chars is enough to recognise a result
 * (a search snippet, the opening of a summary) without one verbose step
 * pushing the whole transcript block off screen.
 */
export const PROGRESS_DISPLAY_TRUNCATE_CHARS = 400

export function truncateForProgress(text: string, max: number = PROGRESS_DISPLAY_TRUNCATE_CHARS): string {
  const t = (text ?? '').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max)}... [${t.length - max} more chars]`
}

const STATUS_WORD: Record<StepStatus, string> = {
  pending: 'waiting',
  running: 'running...',
  completed: 'done',
  failed: 'failed',
  skipped: 'skipped',
}

/** One step's block in the expanded view: header line, then indented
 *  args/result/error, each truncated for display. */
function renderStepView(view: WorkflowStepView, index: number, total: number): string {
  const header = `Step ${index + 1} of ${total}: ${view.step.label} - ${STATUS_WORD[view.status]}`
  const lines = [header]
  if (view.args && Object.keys(view.args).length > 0) {
    lines.push(`  args: ${truncateForProgress(JSON.stringify(view.args), 200)}`)
  }
  if (view.output) {
    const label = view.status === 'running' ? 'so far' : 'result'
    lines.push(`  ${label}: ${truncateForProgress(view.output)}`)
  }
  if (view.error) {
    lines.push(`  error: ${truncateForProgress(view.error)}`)
  }
  return lines.join('\n')
}

/** The whole expanded body: every step, in order, blank-line separated. */
export function renderWorkflowStepList(views: WorkflowStepView[]): string {
  return views.map((v, i) => renderStepView(v, i, views.length)).join('\n\n')
}

/** The collapsed header text (`AgentToolCall.toolName`): the step currently
 *  running, or a summary once nothing is. */
export function workflowProgressHeader(workflowName: string, views: WorkflowStepView[]): string {
  const runningIndex = views.findIndex((v) => v.status === 'running')
  if (runningIndex >= 0) {
    return `Step ${runningIndex + 1} of ${views.length}: ${views[runningIndex].step.label}`
  }
  const settled = views.filter((v) => v.status === 'completed' || v.status === 'failed' || v.status === 'skipped').length
  return `Workflow: ${workflowName} (${settled}/${views.length} steps)`
}

/**
 * A workflow-progress block's `toolName` is always either "Step N of M: ..."
 * (while running) or "Workflow: <name> (...)" / "Workflow: <name> (stopped)"
 * (once settled): see `workflowProgressHeader` and `pushProgressBlock` in
 * useAgentChat.ts. No real tool call ever produces either shape, so this is
 * a safe, cheap way to recognise one of these synthetic blocks without
 * threading a dedicated marker field through persistence.
 */
export function isWorkflowProgressToolName(name: string): boolean {
  return name.startsWith('Step ') || name.startsWith('Workflow:')
}

/**
 * bau/wfprogress.md Runde 2, Blocker (app-restart case): the app can be
 * closed mid-run, which persists a workflow-progress block whose `status`
 * is still 'running': there is no process left to ever move it out of that
 * state, so on the NEXT load it would show a spinner forever for a run that
 * is provably not happening (no engine instance survives a restart). Called
 * from `migratePersistedChat` (chatStore.ts), which already walks every
 * block on every load and is documented as idempotent, so running this
 * again on an already-fixed block is harmless: it only touches blocks that
 * are BOTH a workflow-progress block AND still 'running'.
 *
 * Mutates `call` in place (matching `migrateBlockInPlace`'s own style) and
 * returns whether it changed anything, mainly so callers/tests can assert
 * on it directly.
 */
export function markStaleWorkflowProgressStopped(call: { toolName: string; status: string }): boolean {
  if (call.status !== 'running') return false
  if (!isWorkflowProgressToolName(call.toolName)) return false
  call.status = 'stopped'
  call.toolName = 'Workflow stopped before finishing'
  return true
}
