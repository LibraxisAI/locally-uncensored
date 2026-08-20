# Mock requests, chat area

Written during wave 1 of the chat sweep. Each entry names the element it
blocks and the smallest change that would unblock it.

## 1. `pick_folder` always answers with the same path

`e2e/support/tauri-mock.ts`, case `pick_folder`, returns
`/tmp/lu-e2e/workspace` on every call.

The multi-repo manager in `AgentWorkspaceDialog` dedupes against the primary
path and against the extras already added, so a second call can never add a
second repo. The "Add another repo" button therefore has no observable
effect, and the X that removes an extra has nothing to remove.

Wanted: a queue, so consecutive calls hand back different folders, for
example an option `pickFolderPaths?: string[]` that is consumed one entry per
call and falls back to the last one when the list runs out.

Blocks: `chat.agent-workspace-add-extra.click`, `chat.remove.click`.

## 2. The bundled model's trained context sits exactly on the preset ladder

`e2e/support/tauri-mock.ts`, case `list_bundled_models`, reports
`ctx_train: 32768`.

`ContextDropdown` only renders the "· max" row when the model's ceiling is
NOT one of the presets and lies above the last one (`showMax`). 32768 is a
preset, so the row never exists.

Wanted: a value off the ladder (40960 is what a real Qwen3 reports), or an
option to set `ctx_train` per spec.

Blocks: `chat.context-window.max`.

## 3. The reply carries no `usage`, so the last answer cannot be edited

The chat SSE frames in `chatSseParts` never send a `usage` object, and the
done frame carries none either.

`MessageBubble.canEditAssistant` requires `!isLast || message.usage`, so the
pencil on an answer only appears once a LATER turn exists. Every spec that
wants to edit the newest answer has to send a throwaway second message first.
Not blocking, but it makes specs longer than the journey they describe.

Wanted: a `usage` object on the finish frame, like every real backend sends.

---

# Observations for the conductor (not mock requests)

These are app-side findings from the same wave. They are recorded here because
FINDINGS.md is not this agent's file.

## A. The composer clears itself before anyone decides to send

`src/components/chat/ChatInput.tsx:150`: `handleSend` calls `onSend(...)` and
then unconditionally clears the input. `useChat.sendMessage` has several silent
early returns after that point (no active model, a model that belongs to the
other app mode, the agent path's own `if (!activeModel) return`). When one of
them fires, the typed prompt is gone from the box and nothing was sent, and the
user has no way to tell the difference from a normal send.

Seen for real: during the sweep an agent-mode instruction landed on an empty
transcript with an empty composer, and the run never started. The e2e helper
now retries the send for exactly this reason
(`e2e/support/journeys/chat.ts`, `instruct`).

A fix means `onSend` reporting whether it accepted the turn, which touches
ChatView, CodexView and the Remote surface, so it was not attempted blind in a
QA wave.

## B. A pending tool approval sometimes vanishes with its whole run

Reproduced twice out of roughly eight attempts, always about five seconds after
the approval strip appeared: `generating` for the conversation went false, the
approval queue emptied and the block stayed at `pending_approval` forever. No
`AbortController.abort()` from app code fired, no error was logged, and the
loop never continued to its next turn, so it was not the normal
abort-answers-no path.

Instrumenting `useAgentChat` made it stop happening, which is what a race looks
like. Root cause not pinned. It lives in `src/hooks/useAgentChat.ts` (the run's
`finally` calls `drainApprovals`) together with `src/lib/approval-queue.ts` and
`src/api/agents/tool-executor.ts`, all outside this agent's fix scope.

Worth a dedicated hunt: a run that dies while waiting for a decision leaves the
user with a tool block that can never be answered.

## C. Two chat components are dead

`src/components/chat/ChatModeTabs.tsx` and
`src/components/chat/CodexEventBlock.tsx` are imported nowhere in `src/`. Their
inventory entries (`chat.mode-tab.select`, `chat.codex-event.toggle`) cannot be
reached by any user.

## D. Two inventory ids do not match the DOM testid

`chat.agent-workspace-add-extra.click` and `chat.agent-workspace-save.click`
carry the DOM testids `agent-workspace-add-extra` and `agent-workspace-save`
(no area prefix, no action suffix), see
`src/components/chat/AgentWorkspaceDialog.tsx:210` and `:247`. The specs use the
real testids.
