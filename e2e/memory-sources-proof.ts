import { createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MessageBubble } from '../src/components/chat/MessageBubble'
import { useMemoryStore, __setMemoryEmbedFn } from '../src/stores/memoryStore'
import { useChatStore, flushChatPersist } from '../src/stores/chatStore'
import '../src/index.css'

await useMemoryStore.persist.rehydrate()
await useChatStore.persist.rehydrate()
__setMemoryEmbedFn(async () => [])
function Proof() {
  const [saved, setSaved] = useState(false)
  const conversation = useChatStore(state => state.conversations.find(item => item.id === state.activeConversationId))
  const message = conversation?.messages.find(item => item.role === 'assistant')
  const setup = async () => {
    const origin = useChatStore.getState().createConversation('', '')
    useChatStore.getState().renameConversation(origin, 'Original proof conversation')
    useMemoryStore.getState().addMemory({ type: 'user', title: 'Remembered preference', description: '',
      content: 'Synthetic preference for proof', tags: [], source: origin, scope: 'proof-project' })
    const reply = useChatStore.getState().createConversation('', '')
    useChatStore.getState().addMessage(reply, { id: 'reply', role: 'assistant', content: 'Synthetic answer', timestamp: 1788990000000 })
    const selected = await useMemoryStore.getState().getMemoryContextAsync('', 8192, { scope: 'proof-project' })
    useChatStore.getState().updateMessageMemorySources(reply, 'reply', { ids: selected.memoryIds, scope: 'proof-project' })
    await flushChatPersist()
    setSaved(true)
  }
  return createElement('main', null,
    createElement('button', { onClick: setup }, 'Create sourced answer'),
    saved ? createElement('p', { role: 'status' }, 'Answer save completed') : null,
    createElement('button', { onClick: () => {
      const id = message?.memorySources?.ids[0]
      if (id) useMemoryStore.setState(state => ({ entries: state.entries.map(entry => entry.id === id ? { ...entry, stale: true } : entry) }))
    } }, 'Mark source outdated'),
    createElement('button', { onClick: () => {
      const id = message?.memorySources?.ids[0]
      if (id) useMemoryStore.getState().updateMemory(id, { scope: 'different-project' })
    } }, 'Move source project'),
    createElement('button', { onClick: () => {
      const id = message?.memorySources?.ids[0]
      if (id) useMemoryStore.getState().updateMemory(id, { sensitive: true })
    } }, 'Mark source sensitive'),
    createElement('button', { onClick: () => {
      const id = message?.memorySources?.ids[0]
      if (id) useMemoryStore.getState().removeMemory(id)
    } }, 'Forget source'),
    message ? createElement(MessageBubble, { message }) : null)
}
createRoot(document.getElementById('root')!).render(createElement(Proof))
