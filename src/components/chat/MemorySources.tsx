import { useMemoryStore, memoryMatchesScope } from '../../stores/memoryStore'
import { useChatStore } from '../../stores/chatStore'
import { isStale } from '../../lib/memory-retrieval'
import type { Message } from '../../types/chat'

export function MemorySources({ sources }: { sources: Message['memorySources'] }) {
  const entries = useMemoryStore(state => state.entries)
  const conversations = useChatStore(state => state.conversations)
  if (!sources || !Array.isArray(sources.ids)) return null
  const ids = new Set(sources.ids.filter(id => typeof id === 'string'))
  const selected = entries.filter(entry => ids.has(entry.id) && !entry.sensitive &&
    !isStale(entry) && memoryMatchesScope(entry, sources.scope))
  if (selected.length === 0) return null
  return (
    <details className="mt-2 text-xs text-gray-600 dark:text-gray-300">
      <summary className="cursor-pointer">Memory sources ({selected.length})</summary>
      <p className="mt-2">Selected as memory context, not verified citations. Current records are shown; deleted, outdated and sensitive records are hidden.</p>
      <ul className="mt-2 space-y-2">
        {selected.map(entry => {
          const origin = conversations.find(conversation => conversation.id === entry.source)
          return <li key={entry.id}>
            <span className="font-medium">{entry.title}</span>
            <p>{origin ? `Chat: ${origin.title}` : entry.source === 'manual' ? 'Manual entry' : 'Original source unavailable'}</p>
            {entry.scope && <p>Project: {entry.scope}</p>}
            {entry.sourceKind && <p>Source type: {entry.sourceKind}</p>}
          </li>
        })}
      </ul>
    </details>
  )
}
