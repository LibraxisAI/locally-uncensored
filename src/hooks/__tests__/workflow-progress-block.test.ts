/**
 * @vitest-environment jsdom
 *
 * bau/wfprogress.md: the "run workflow <name>" chat trigger used to add ONE
 * static assistant message ("Running workflow: **X**...") that never changed
 * for the whole run — the only feedback a multi-minute workflow gave was
 * three static dots, unlike every real tool call, which shows a running/
 * working ToolCallBlock. This drives the REAL `useAgentChat` hook (the same
 * one ChatView uses) over real workflows and asserts on the progress
 * message's `agentBlocks`: a single AgentToolCall-shaped block that starts at
 * "waiting" for every step, updates to "running"/"done"/"failed" per step,
 * and ends up clickable/expandable with the full step list — reusing
 * ToolCallBlock, not a new component.
 *
 * Run: npx vitest run src/hooks/__tests__/workflow-progress-block.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../api/cloud/supabase', () => ({
  getAccessToken: async () => 'session-token-abc',
}))
vi.mock('../../api/rag', () => ({
  retrieveContext: async () => ({ context: { chunks: [], query: '', documentIds: [] }, scoredChunks: [] }),
  generateEmbeddings: async () => [[0.1, 0.2]],
}))
vi.mock('../../lib/ttsBridge', () => ({ autoSpeak: () => {} }))
vi.mock('../../api/vram-handoff', () => ({ requestGenerationCancel: () => {} }))
vi.mock('../useMemory', () => ({
  useMemory: () => ({ extractAndSave: async () => {} }),
  extractMemoriesFromPair: async () => {},
}))

import { useAgentChat, __activeAgentRunConvIdsForTests } from '../useAgentChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useAgentWorkflowStore } from '../../stores/agentWorkflowStore'
import { usePermissionStore } from '../../stores/permissionStore'
import { useAgentTaskStore } from '../../stores/agentTaskStore'
import { useAgentLoopStore } from '../../stores/agentLoopStore'
import { useGenerationStore } from '../../stores/generationStore'
import { useTodoStore } from '../../stores/todoStore'
import { useToolAuditStore } from '../../stores/toolAuditStore'
import { DEFAULT_SETTINGS } from '../../lib/constants'
import { __resetRunStopsForTests } from '../../lib/run-stop'
import { __resetRunLanesForTests } from '../../lib/run-lanes'
import { toolRegistry, registerBuiltinTools } from '../../api/mcp'
import { headApproval, resetApprovals } from '../../lib/approval-queue'
import { useMemoryStore } from '../../stores/memoryStore'
import type { AgentToolCall } from '../../types/agent-mode'

const MODEL = 'openai::local-builtin-model'
const tick = () => new Promise((r) => setTimeout(r, 0))

function seed(): string {
  const convId = useChatStore.getState().createConversation(MODEL, '')
  useChatStore.getState().setActiveConversation(convId)
  return convId
}

// Two `memory_save` steps: synchronous and local (no toolRegistry, no
// backend call), same as workflow-engine-branching.test.ts uses to exercise
// the real engine without a Tauri bridge. `shell_execute`/`web_search` would
// need a live backend this test environment does not have; the SUCCESS path
// only needs two steps that genuinely complete, and the progress block does
// not care which step type produced the output.
function twoStepWorkflow() {
  return {
    id: 'wf-progress-two-step',
    name: 'Progress Two Step',
    description: '',
    icon: 'Zap',
    steps: [
      { id: 's1', type: 'memory_save' as const, label: 'First step', memorySave: { type: 'reference' as const, titleTemplate: 'one', contentTemplate: 'first result', tags: [] } },
      { id: 's2', type: 'memory_save' as const, label: 'Second step', memorySave: { type: 'reference' as const, titleTemplate: 'two', contentTemplate: 'second result', tags: [] } },
    ],
    variables: {},
    isBuiltIn: false,
    createdAt: 0,
    updatedAt: 0,
  }
}

function blockedWorkflow() {
  return {
    id: 'wf-progress-blocked',
    name: 'Progress Blocked',
    description: '',
    icon: 'Zap',
    steps: [{ id: 's1', type: 'tool' as const, label: 'Run it', toolName: 'shell_execute', toolArgs: { command: 'echo hi' } }],
    variables: {},
    isBuiltIn: false,
    createdAt: 0,
    updatedAt: 0,
  }
}

/** The progress message is the assistant message right after the user's
 *  "run workflow ..." turn, carrying the ONE evolving tool_call block. */
function progressToolCall(convId: string): AgentToolCall {
  const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!
  const progressMsg = conv.messages.find((m) => m.role === 'assistant' && m.content.startsWith('Running workflow:'))!
  const block = progressMsg.agentBlocks!.find((b) => b.phase === 'tool_call')!
  return block.toolCalls![0]
}

beforeEach(() => {
  registerBuiltinTools(toolRegistry)
  __resetRunStopsForTests()
  __resetRunLanesForTests()
  resetApprovals()
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useAgentTaskStore.setState({ byConv: {} })
  useAgentLoopStore.setState({ loops: {} })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useTodoStore.setState({ byConversation: {}, updatedAt: {} })
  useToolAuditStore.setState({ entries: {} })
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, appMode: 'local', cavemanMode: 'off' },
  })
  useProviderStore.setState((s) => ({
    providers: { ...s.providers, openai: { ...s.providers.openai, enabled: true } },
  }))
  useModelStore.setState({ models: [], activeModel: MODEL })
  useAgentWorkflowStore.setState({ workflows: [twoStepWorkflow(), blockedWorkflow()] })
  usePermissionStore.getState().setGlobalPermission('terminal', 'confirm')
  vi.spyOn(useMemoryStore.getState(), 'addMemory').mockImplementation(() => 'mem-id')
})

afterEach(() => {
  usePermissionStore.getState().resetToDefaults()
  vi.restoreAllMocks()
})

describe('Schritt 1 und Schritt n: die Stufenliste wird live aktualisiert', () => {
  it('endet mit BEIDEN Schritten als "done" und einer Zusammenfassung im Titel', async () => {
    const { result } = renderHook(() => useAgentChat())
    const convId = seed()

    await act(async () => {
      await result.current.sendAgentMessage('run workflow Progress Two Step')
      await tick()
      await tick()
    })

    const tc = progressToolCall(convId)
    expect(tc.status).toBe('completed')
    expect(tc.toolName).toBe('Workflow: Progress Two Step (2/2 steps)')
    expect(tc.result).toContain('Step 1 of 2: First step - done')
    expect(tc.result).toContain('Step 2 of 2: Second step - done')
    expect(tc.result).toContain('Saved to memory: one')
    expect(tc.result).toContain('Saved to memory: two')

    // The existing honest completion message is untouched by any of this.
    const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!
    const lastAssistant = [...conv.messages].reverse().find((m) => m.role === 'assistant')!
    expect(lastAssistant.content).toMatch(/Workflow complete \(2\/2 steps\)\./)
  })

  it('NEGATIVKONTROLLE: ohne den Fix gaebe es gar keinen agentBlocks-Eintrag auf der Fortschrittsnachricht', async () => {
    const { result } = renderHook(() => useAgentChat())
    const convId = seed()

    await act(async () => {
      await result.current.sendAgentMessage('run workflow Progress Two Step')
      await tick()
      await tick()
    })

    const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!
    const progressMsg = conv.messages.find((m) => m.role === 'assistant' && m.content.startsWith('Running workflow:'))!
    // This is exactly what the old code left behind: a message with NO
    // agentBlocks at all, so the chat rendered nothing but its own static
    // "..." text for the whole run. The fix's whole point is that this is
    // no longer true.
    expect(progressMsg.agentBlocks?.length ?? 0).toBeGreaterThan(0)
  })
})

describe('Fehlerfall: ein blockiertes Werkzeug markiert seinen Schritt "failed"', () => {
  it('die bestehende Fehlermeldung bleibt unveraendert, UND der Block zeigt "failed"', async () => {
    usePermissionStore.getState().setGlobalPermission('terminal', 'blocked')
    const { result } = renderHook(() => useAgentChat())
    const convId = seed()

    await act(async () => {
      await result.current.sendAgentMessage('run workflow Progress Blocked')
      await tick()
    })

    const tc = progressToolCall(convId)
    expect(tc.status).toBe('failed')
    expect(tc.result).toContain('Step 1 of 1: Run it - failed')
    expect(tc.result).toMatch(/error: /)

    const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!
    const lastAssistant = [...conv.messages].reverse().find((m) => m.role === 'assistant')!
    expect(lastAssistant.content).toMatch(/Workflow stopped at step 1 of 1/)
  })
})

describe('Stop: der laufende Fortschrittsblock haelt an, der Lauf raeumt sich ab', () => {
  it('waehrend einer wartenden Freigabe zeigt der Block "running", und Stop beendet den Lauf', async () => {
    usePermissionStore.getState().setGlobalPermission('terminal', 'confirm')
    const { result } = renderHook(() => useAgentChat())
    const convId = seed()

    let sendDone!: Promise<void>
    await act(async () => {
      sendDone = result.current.sendAgentMessage('run workflow Progress Blocked')
      await tick()
      await tick()

      expect(__activeAgentRunConvIdsForTests()).toContain(convId)
      expect(headApproval(convId)).not.toBeNull()

      const tc = progressToolCall(convId)
      expect(tc.status).toBe('running')
      expect(tc.result).toContain('Step 1 of 1: Run it - running...')

      result.current.stopAgent(convId)
      await sendDone
      await tick()
    })

    expect(headApproval(convId)).toBeNull()
    expect(__activeAgentRunConvIdsForTests()).not.toContain(convId)
  })
})
