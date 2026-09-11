import { expect, it } from 'vitest'
import { ONBOARDING_MODELS } from '../constants'
import { getMainstreamTextModels } from '../../api/discover'

it('uses an existing catalog model meeting the 7B minimum with exact download integrity', () => {
  expect(ONBOARDING_MODELS).toHaveLength(1)
  const starter = ONBOARDING_MODELS[0]
  const catalog = getMainstreamTextModels().find(model => model.filename === starter.filename)
  expect(catalog).toBeDefined()
  expect(catalog!.tags).toContain('7B')
  expect(starter.downloadUrl).toBe(catalog!.downloadUrl)
  expect(starter.expectedBytes).toBe(4683074240)
  expect(starter.sha256).toBe('65b8fcd92af6b4fefa935c625d1ac27ea29dcb6ee14589c55a8f115ceaaa1423')
  expect(Math.round(starter.sizeGB * 1_073_741_824)).toBe(starter.expectedBytes)
  expect(starter.description).not.toMatch(/runs on anything|instant|30 seconds/i)
})
