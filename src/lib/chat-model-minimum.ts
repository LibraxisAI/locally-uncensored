import type { DiscoverModel } from '../api/model-bundles'

export const SMALL_CHAT_MODEL_WARNING = 'Below 7B: for local loading tests and experiments only. Not recommended for chat or agent work. Choose a model with at least 7B parameters.'

/** Read parameter-count tags, never file sizes or MoE active-parameter counts. */
export function isBelowChatMinimum(model: Pick<DiscoverModel, 'tags'>): boolean {
  return model.tags.some(tag => {
    const match = /^(\d+(?:\.\d+)?)B$/i.exec(tag.trim())
    return match !== null && Number(match[1]) > 0 && Number(match[1]) < 7
  })
}

export function chatRecommendationGroups(groups: DiscoverModel[][]): DiscoverModel[][] {
  return groups.filter(group => group.length > 0 && group.every(model => !isBelowChatMinimum(model)))
}
