import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemorySettings } from '../src/components/settings/MemorySettings'
import { useMemoryStore, __setMemoryEmbedFn } from '../src/stores/memoryStore'
import '../src/index.css'

await useMemoryStore.persist.rehydrate()
__setMemoryEmbedFn(async () => [])
createRoot(document.getElementById('root')!).render(createElement(MemorySettings))
document.getElementById('retrieve')!.addEventListener('click', async () => {
  document.getElementById('result')!.textContent =
    await useMemoryStore.getState().getMemoriesForPromptAsync('private', 8192) || 'No eligible memories'
})
