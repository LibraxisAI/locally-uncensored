/**
 * Who is busy: this chat, or another one.
 *
 * The composer used to read ONE boolean, `useChat().isGenerating`, which is
 * true while anything anywhere is answering. So every other conversation lost
 * its Send button and grew a Stop button that aborted the foreign run
 * (measured on the box, T1 nebenfund 4 and T1 point 4). The per-conversation
 * truth already existed in `generationStore.generating`; only the composer
 * never asked it.
 *
 * `hookGenerating` stays in the answer on purpose. It is wider than the map:
 * it also covers a run this app instance did not register, an orphaned run
 * picked up after a reload, and the window between starting a stream and
 * registering it. When it is true and no OTHER conversation owns a run, the
 * run belongs to the chat on screen, and that chat keeps its Stop button. The
 * rule never turns a Stop into a bare Send, so nothing becomes unstoppable.
 */
export interface ComposerBusy {
  /** The conversation on screen is answering: it shows Stop. */
  thisChat: boolean
  /** Some OTHER conversation is answering: this one says so instead of going quiet. */
  otherChat: boolean
}

export function composerBusy(
  hookGenerating: boolean,
  generatingMap: Record<string, boolean>,
  activeConversationId: string | null,
): ComposerBusy {
  const otherChat = Object.entries(generatingMap)
    .some(([id, on]) => on && id !== activeConversationId)
  const own = !!activeConversationId && !!generatingMap[activeConversationId]
  return {
    thisChat: own || (hookGenerating && !otherChat),
    otherChat: otherChat && !own,
  }
}
