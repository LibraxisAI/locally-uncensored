// @vitest-environment jsdom
/**
 * C2 (Desktop Create parity, web reference: apps/web/components/create/
 * experimental/ModelChip.tsx). Two pieces:
 *
 *  1. `adult` on the Desktop CloudModel type (src/lib/render/cloud-models.ts)
 *     — previously absent entirely, so every "Spicy" seed model looked
 *     identical to a filtered one. A live /api/jobs/catalog payload without
 *     the field (older server, pre web-fix) must read as "not adult", never
 *     throw or crash the picker — it's a plain optional boolean.
 *  2. The "No refusals" badge in ModelChip's CloudModelChip, pale while the
 *     account's content policy still filters and vivid when it's 'off' —
 *     same rule as web, adapted to Desktop's own useContentPolicy hook
 *     (src/hooks/useContentPolicy.ts) instead of web's use-content-policy.
 *
 * Run: npx vitest run src/components/create/experimental/__tests__/no-refusals-badge.test.tsx
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { CLOUD_MODEL_SEED } from '../../../../lib/render/cloud-models'

const policyState = vi.hoisted(() => ({ value: 'soft' as 'strict' | 'soft' | 'off' }))
vi.mock('../../../../hooks/useContentPolicy', () => ({
  useContentPolicy: () => policyState.value,
  primeContentPolicyCache: vi.fn(),
}))

import { ModelChip } from '../ModelChip'
import { useCreateStore } from '../../../../stores/createStore'
import { useCloudCatalogStore } from '../../../../stores/cloudCatalogStore'

afterEach(() => {
  cleanup()
  policyState.value = 'soft'
})

describe('CloudModel.adult (seed data)', () => {
  it('marks every hosted "Spicy" endpoint adult, and nothing else', () => {
    const adultIds = CLOUD_MODEL_SEED.filter((m) => m.adult).map((m) => m.id).sort()
    const spicyIds = CLOUD_MODEL_SEED.filter((m) => m.label.includes('Spicy')).map((m) => m.id).sort()
    expect(adultIds).toEqual(spicyIds)
    expect(adultIds.length).toBeGreaterThan(0)
  })
})

describe('ModelChip "No refusals" badge', () => {
  const setup = (modelId: string) => {
    // videoSubMode 'i2v' derives the 'animate' intent (deriveIntent in
    // createStore.ts) — the picker whose model filter (i2v !== false) actually
    // keeps the i2v-only "Spicy" seed models in list, unlike the plain 'video'
    // (t2v) intent which filters them straight back out.
    useCreateStore.setState({
      backend: 'cloud', mode: 'video', videoSubMode: 'i2v', removebg: false, utilityOp: null, cloudOp: null,
      cloudVideoModel: modelId, cloudImageModel: '', cloudOpModel: '',
    })
    useCloudCatalogStore.setState({ models: CLOUD_MODEL_SEED })
  }

  it('shows "No refusals" pale while the account content policy still filters', () => {
    policyState.value = 'soft'
    setup('wan-2.2-spicy')
    render(<ModelChip />)
    const label = screen.getByText('No refusals')
    // The Select renders the current value's badge next to the trigger.
    expect(label.className).toContain('text-gray-500')
    expect(label.className).not.toContain('text-purple-600')
  })

  it('shows "No refusals" vivid once the account policy is off', () => {
    policyState.value = 'off'
    setup('wan-2.2-spicy')
    render(<ModelChip />)
    const label = screen.getByText('No refusals')
    expect(label.className).toContain('text-purple-600')
  })

  it('a non-adult cloud model keeps the plain Cloud badge, never "No refusals"', () => {
    policyState.value = 'off'
    setup('wan-2.2-720p')
    render(<ModelChip />)
    expect(screen.queryByText('No refusals')).toBeNull()
    expect(screen.getByText('Cloud')).toBeTruthy()
  })
})
