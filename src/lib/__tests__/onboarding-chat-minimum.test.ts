import { expect, it } from 'vitest'
import { ONBOARDING_MODELS } from '../constants'
import { getMainstreamTextModels } from '../../api/discover'

it('uses an existing catalog model meeting the 7B minimum with exact download integrity', () => {
  const starter = ONBOARDING_MODELS.find(m => m.name === 'qwen2.5-7b')
  expect(starter).toBeDefined()
  const catalog = getMainstreamTextModels().find(model => model.filename === starter!.filename)
  expect(catalog).toBeDefined()
  expect(catalog!.tags).toContain('7B')
  expect(starter!.downloadUrl).toBe(catalog!.downloadUrl)
  expect(starter!.expectedBytes).toBe(4683074240)
  expect(starter!.sha256).toBe('65b8fcd92af6b4fefa935c625d1ac27ea29dcb6ee14589c55a8f115ceaaa1423')
  expect(Math.round(starter!.sizeGB * 1_073_741_824)).toBe(starter!.expectedBytes)
  expect(starter!.description).not.toMatch(/runs on anything|instant|30 seconds/i)
})

// Second onboarding pick, added so the wizard offers an agent-capable model
// above the 9B floor getRecommendedAgentModels() names as where tool calls
// start holding together. One source of truth: repo and filename come from
// the Discover catalog entry (api/discover.ts, getMainstreamTextModels,
// name 'Qwen 3.5 9B'), not typed twice.
it('the second onboarding pick matches the Discover catalog entry it is drawn from', () => {
  const nineB = ONBOARDING_MODELS.find(m => m.name === 'qwen3.5-9b')
  expect(nineB).toBeDefined()
  const catalog = getMainstreamTextModels().find(model => model.name === 'Qwen 3.5 9B')
  expect(catalog).toBeDefined()
  expect(nineB!.downloadUrl).toBe(catalog!.downloadUrl)
  expect(nineB!.filename).toBe(catalog!.filename)
  expect(nineB!.sizeGB).toBe(catalog!.sizeGB)
  expect(catalog!.tags).toContain('9B')
  expect(catalog!.agent).toBe(true)
  expect(nineB!.agent).toBe(true)
  // Not the badge: the badge follows hardware, this field is the display flag
  // the Discover page filters on (ModelTiles.tsx).
  expect(nineB!.vramGB).toBe(8)
})

it('both onboarding entries are present and distinct', () => {
  expect(ONBOARDING_MODELS.length).toBeGreaterThanOrEqual(2)
  const names = ONBOARDING_MODELS.map(m => m.name)
  expect(names).toContain('qwen2.5-7b')
  expect(names).toContain('qwen3.5-9b')
})
