import { describe, it, expect } from 'vitest'
import { migratePersistedChat } from '../chatStore'
import type { AgentBlock, AgentToolCall } from '../../types/agent-mode'

const legacyCall: AgentToolCall = {
  id: 't1',
  toolName: 'web_search',
  args: { query: 'x' },
  status: 'completed',
  timestamp: 1,
}

/**
 * The migration mutates in place and hands back the SAME object, so the
 * assertions below need a typed view of it. `migratePersistedChat` itself
 * reports `unknown`, which is honest: it takes whatever a previous build of
 * the app persisted.
 */
interface PersistedBlock {
  id: string
  toolCall?: AgentToolCall
  toolCalls?: AgentToolCall[]
}
interface PersistedChat {
  conversations: { messages: { content?: string; agentBlocks?: PersistedBlock[] }[] }[]
}
const migrated = (state: unknown): PersistedChat => migratePersistedChat(state) as PersistedChat

describe('chatStore — migratePersistedChat', () => {
  it('returns null/undefined/non-object shapes unchanged', () => {
    expect(migratePersistedChat(null)).toBe(null)
    expect(migratePersistedChat(undefined)).toBe(undefined)
    expect(migratePersistedChat({})).toEqual({})
  })

  it('leaves conversations without agentBlocks untouched', () => {
    const state = {
      conversations: [
        {
          id: 'c1',
          messages: [{ id: 'm1', role: 'user', content: 'hi' }],
        },
      ],
    }
    const result = migrated(state)
    expect(result.conversations[0].messages[0].content).toBe('hi')
  })

  it('wraps legacy singular toolCall into toolCalls array across nested messages', () => {
    const block: AgentBlock = {
      id: 'b1',
      phase: 'tool_call',
      content: '',
      timestamp: 1,
      toolCall: legacyCall,
    }
    const state = {
      conversations: [
        {
          id: 'c1',
          messages: [
            {
              id: 'm1',
              role: 'assistant',
              content: 'ok',
              agentBlocks: [block],
            },
          ],
        },
      ],
    }
    const result = migrated(state)
    const migratedBlock = result.conversations[0].messages[0].agentBlocks![0]
    expect(migratedBlock.toolCalls).toEqual([legacyCall])
    expect(migratedBlock.toolCall).toBe(legacyCall) // preserved for transition
  })

  it('migrates multiple blocks in multiple conversations', () => {
    const state = {
      conversations: [
        {
          id: 'c1',
          messages: [
            {
              id: 'm1',
              agentBlocks: [
                { id: 'b1', phase: 'tool_call', content: '', timestamp: 1, toolCall: legacyCall },
                { id: 'b2', phase: 'thinking', content: 'hmm', timestamp: 2 },
              ],
            },
          ],
        },
        {
          id: 'c2',
          messages: [
            {
              id: 'm2',
              agentBlocks: [
                { id: 'b3', phase: 'tool_call', content: '', timestamp: 3, toolCall: { ...legacyCall, id: 't2' } },
              ],
            },
          ],
        },
      ],
    }
    const result = migrated(state)
    expect(result.conversations[0].messages[0].agentBlocks![0].toolCalls).toHaveLength(1)
    // Non-tool block untouched.
    expect(result.conversations[0].messages[0].agentBlocks![1].toolCalls).toBeUndefined()
    expect(result.conversations[1].messages[0].agentBlocks![0].toolCalls?.[0].id).toBe('t2')
  })

  it('is idempotent — re-running migration does not double-wrap', () => {
    const state = {
      conversations: [
        {
          id: 'c1',
          messages: [
            {
              id: 'm1',
              agentBlocks: [
                {
                  id: 'b1',
                  phase: 'tool_call',
                  content: '',
                  timestamp: 1,
                  toolCall: legacyCall,
                  toolCalls: [legacyCall],
                },
              ],
            },
          ],
        },
      ],
    }
    const once = migratePersistedChat(state)
    const twice = migrated(once)
    expect(twice.conversations[0].messages[0].agentBlocks![0].toolCalls).toEqual([legacyCall])
  })

  it('handles malformed agentBlocks array without crashing', () => {
    const state = {
      conversations: [
        {
          id: 'c1',
          messages: [
            {
              id: 'm1',
              agentBlocks: [null, undefined, { id: 'b1', phase: 'tool_call', content: '', timestamp: 1 }],
            },
          ],
        },
      ],
    }
    expect(() => migratePersistedChat(state)).not.toThrow()
  })

  it('tolerates non-array conversations gracefully', () => {
    expect(migratePersistedChat({ conversations: 'not-an-array' })).toEqual({ conversations: 'not-an-array' })
  })

  // The per-answer "Memory sources" chip (and the field feeding it) was
  // removed 2026-09-19: the purple brain icon in the session strip below
  // the transcript still opens Memory, so repeating it under every reply
  // was dropped.
  // A conversation saved by an older build can still carry `memorySources`
  // on its messages. There is no migration for it, it is simply ignored.
  it('loads an old message carrying the retired memorySources field without breaking', () => {
    const state = {
      conversations: [
        {
          id: 'c1',
          messages: [
            {
              id: 'm1',
              role: 'assistant',
              content: 'hi',
              memorySources: { ids: ['old-1'], scope: 'legacy', owner: 'A' },
            },
          ],
        },
      ],
    }
    expect(() => migratePersistedChat(state)).not.toThrow()
    const result = migrated(state)
    expect(result.conversations[0].messages[0].content).toBe('hi')
  })

  // review-wfprogress.md, BLOCKER (Runde 2), app-restart case: the app can
  // be closed mid-workflow-run, which persists a progress block whose
  // `status` is still 'running': no process survives a restart to ever
  // move it out of that state, so on the NEXT load (this migration, which
  // runs on every load) it must be rewritten as honestly 'stopped' instead
  // of showing a spinner for a run that provably is not happening.
  describe('markiert einen ueber den Neustart hinweg "running" gebliebenen Workflow-Block als "stopped"', () => {
    it('bei einem einzelnen Fortschrittsblock', () => {
      const staleProgressCall: AgentToolCall = {
        id: 'p1',
        toolName: 'Step 2 of 3: Summarize',
        args: {},
        status: 'running',
        timestamp: 1,
      }
      const state = {
        conversations: [
          {
            id: 'c1',
            messages: [
              {
                id: 'm1',
                agentBlocks: [
                  { id: 'b1', phase: 'tool_call', content: '', timestamp: 1, toolCalls: [staleProgressCall] },
                ],
              },
            ],
          },
        ],
      }
      const result = migrated(state)
      const tc = result.conversations[0].messages[0].agentBlocks![0].toolCalls![0]
      expect(tc.status).toBe('stopped')
      expect(tc.toolName).not.toMatch(/^Step /)
    })

    it('NEGATIVKONTROLLE: ein echter, noch laufender Werkzeug-Aufruf bleibt "running"', () => {
      // Without the isWorkflowProgressToolName() guard, this would also get
      // rewritten to 'stopped', which would be wrong the moment a tool
      // call is shown mid-flight in the SAME session (no restart happened).
      const realRunningCall: AgentToolCall = {
        id: 't1', toolName: 'shell_execute', args: { command: 'sleep 5' }, status: 'running', timestamp: 1,
      }
      const state = {
        conversations: [
          { id: 'c1', messages: [{ id: 'm1', agentBlocks: [{ id: 'b1', phase: 'tool_call', content: '', timestamp: 1, toolCalls: [realRunningCall] }] }] },
        ],
      }
      const result = migrated(state)
      expect(result.conversations[0].messages[0].agentBlocks![0].toolCalls![0].status).toBe('running')
    })

    it('bereits abgeschlossene Workflow-Bloecke bleiben unangetastet', () => {
      const settledCall: AgentToolCall = {
        id: 'p1', toolName: 'Workflow: Research Topic (3/3 steps)', args: {}, status: 'completed', timestamp: 1,
      }
      const state = {
        conversations: [
          { id: 'c1', messages: [{ id: 'm1', agentBlocks: [{ id: 'b1', phase: 'tool_call', content: '', timestamp: 1, toolCalls: [settledCall] }] }] },
        ],
      }
      const result = migrated(state)
      expect(result.conversations[0].messages[0].agentBlocks![0].toolCalls![0].status).toBe('completed')
    })

    it('ist idempotent ueber die legacy toolCall/toolCalls-Migration hinweg', () => {
      const staleLegacyCall: AgentToolCall = {
        id: 'p1', toolName: 'Workflow: Research Topic (1/3 steps)', args: {}, status: 'running', timestamp: 1,
      }
      const state = {
        conversations: [
          { id: 'c1', messages: [{ id: 'm1', agentBlocks: [{ id: 'b1', phase: 'tool_call', content: '', timestamp: 1, toolCall: staleLegacyCall }] }] },
        ],
      }
      const once = migratePersistedChat(state)
      const twice = migrated(once)
      const tc = twice.conversations[0].messages[0].agentBlocks![0].toolCalls![0]
      expect(tc.status).toBe('stopped')
      // The legacy singular field points at the SAME object migrateBlockInPlace
      // keeps in sync, so it must read the rewritten status too.
      expect(twice.conversations[0].messages[0].agentBlocks![0].toolCall!.status).toBe('stopped')
    })
  })
})
