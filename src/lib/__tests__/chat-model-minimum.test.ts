import { describe, expect, it } from 'vitest'
import { getMainstreamTextModels, getUncensoredTextModels } from '../../api/discover'
import { chatRecommendationGroups, isBelowChatMinimum } from '../chat-model-minimum'

describe('chat catalog minimum', () => {
  it('uses parameter counts, not quantization, file size or MoE active counts', () => {
    for (const tag of ['0.5B', '3B', '3.8B', '4B', '6.9B']) expect(isBelowChatMinimum({ tags: [tag] })).toBe(true)
    for (const tag of ['7B', '8B', '70B', '3 GB', 'Q4_K_M', 'A3B', '30B-A3B', 'unknown']) expect(isBelowChatMinimum({ tags: [tag] })).toBe(false)
  })

  it('covers every explicitly tagged sub-7B entry in both text catalogs', () => {
    const models = [...getUncensoredTextModels(), ...getMainstreamTextModels()]
    const small = models.filter(isBelowChatMinimum)
    expect(small.length).toBe(12)
    const picks = chatRecommendationGroups(models.map(model => [model]))
    expect(picks.flat().some(isBelowChatMinimum)).toBe(false)
    expect(picks.length).toBe(models.length - small.length)
    expect(small.find(model => model.filename === 'Hermes-3-Llama-3.2-3B.Q4_K_M.gguf')).toBeDefined()
  })

  it('excludes mixed-size groups so a selected small variant cannot become a pick', () => {
    const models = getUncensoredTextModels()
    const small = models.find(isBelowChatMinimum)!
    const large = models.find(model => model.tags.includes('8B'))!
    expect(chatRecommendationGroups([[], [small, large], [large]])).toEqual([[large]])
  })
})
