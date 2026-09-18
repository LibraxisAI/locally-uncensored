/**
 * K9 nachbessert (review-create.md, GH #136, LUSTIFY! v10 Krea2 and
 * FinePorn author workflows): Krea 2 is an AuraFlow-family checkpoint, and
 * both reported author graphs carry ModelSamplingAuraFlow at shift 4, plus
 * ConditioningZeroOut for the negative branch at CFG 1 (the negative prompt
 * is a no-op there, so zeroing it out replaces a wasted CLIPTextEncode pass,
 * same rule buildDynamicWorkflow already applies to unet_ernie_image).
 * Neither node existed on the unet_krea2 path before this fix; the sigma
 * schedule the model was actually trained on never applied.
 *
 * Run: npx vitest run src/api/__tests__/krea2-sampling-k9.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../comfyui-nodes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../comfyui-nodes')>()
  return { ...actual, getAllNodeInfo: vi.fn() }
})
vi.mock('../backend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../backend')>()
  return { ...actual, localFetch: vi.fn(), comfyuiUrl: (p: string) => `http://test${p}` }
})

import { buildDynamicWorkflow } from '../dynamic-workflow'
import { getAllNodeInfo } from '../comfyui-nodes'
import { localFetch } from '../backend'
import { classTypes, nodeOf } from './graph-test-support'

const KREA2_NODES = {
  UNETLoader: { input: { required: { unet_name: [['krea2-lustify-v10.safetensors']] } } },
  CLIPLoader: { input: { required: { clip_name: [['qwen3vl_4b.safetensors']], type: [['krea2']] } } },
  VAELoader: { input: { required: { vae_name: [['krea_vae.safetensors']] } } },
  ModelSamplingAuraFlow: { input: { required: {} } },
  ConditioningZeroOut: { input: { required: {} } },
  EmptyLatentImage: { input: { required: {} } },
  KSampler: { input: { required: {} } },
  CLIPTextEncode: { input: { required: {} } },
  VAEDecode: { input: { required: {} } },
  SaveImage: { input: { required: {} } },
}

const baseParams = {
  model: 'krea2-lustify-v10.safetensors',
  prompt: 'a red jacket', negativePrompt: '',
  sampler: 'euler', scheduler: 'simple',
  width: 1024, height: 1024, steps: 8, cfgScale: 1, seed: 1, batchSize: 1,
} as never

describe('unet_krea2 graph (K9, GH #136)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAllNodeInfo).mockResolvedValue(KREA2_NODES as never)
    vi.mocked(localFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        VAELoader: { input: { required: { vae_name: [['krea_vae.safetensors']] } } },
        CLIPLoader: { input: { required: { clip_name: [['qwen3vl_4b.safetensors']], type: [['krea2']] } } },
      }),
    } as never)
  })

  it('carries ModelSamplingAuraFlow at shift 4, wired between the UNETLoader and KSampler', async () => {
    const wf = await buildDynamicWorkflow(baseParams)
    expect(classTypes(wf)).toContain('ModelSamplingAuraFlow')
    const [shiftId, shiftNode] = nodeOf(wf, 'ModelSamplingAuraFlow')!
    expect(shiftNode.inputs.shift).toBe(4.0)
    const [, unetNode] = nodeOf(wf, 'UNETLoader')!
    expect(shiftNode.inputs.model).toEqual([Object.entries(wf).find(([, n]) => n === unetNode)![0], 0])
    const [, sampler] = nodeOf(wf, 'KSampler')!
    expect(sampler.inputs.model).toEqual([shiftId, 0])
  })

  it('at CFG 1, the negative branch is ConditioningZeroOut, not CLIPTextEncode', async () => {
    const wf = await buildDynamicWorkflow({ ...(baseParams as object), cfgScale: 1 } as never)
    expect(classTypes(wf)).toContain('ConditioningZeroOut')
    const [, zeroOut] = nodeOf(wf, 'ConditioningZeroOut')!
    const [posId] = nodeOf(wf, 'CLIPTextEncode')!
    expect(zeroOut.inputs.conditioning).toEqual([posId, 0])
    // Exactly one CLIPTextEncode (positive only); the negative never got one.
    expect(Object.values(wf).filter((n) => n.class_type === 'CLIPTextEncode')).toHaveLength(1)
  })

  it('above CFG 1, the negative branch stays a real CLIPTextEncode (the prompt is not a no-op there)', async () => {
    const wf = await buildDynamicWorkflow({ ...(baseParams as object), cfgScale: 4, negativePrompt: 'blurry' } as never)
    expect(classTypes(wf)).not.toContain('ConditioningZeroOut')
    expect(Object.values(wf).filter((n) => n.class_type === 'CLIPTextEncode')).toHaveLength(2)
  })
})
