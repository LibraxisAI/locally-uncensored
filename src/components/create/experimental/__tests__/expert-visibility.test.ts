// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useCreateStore } from '../../../../stores/createStore'
import { ParamGroups } from '../ParamGroups'

const host = vi.hoisted(() => ({ mlx: false }))
vi.mock('../../../../api/mlx-image', () => ({ isMlxImageHost: () => host.mlx }))
vi.mock('../../../../api/comfyui', () => ({ classifyModel: () => 'sdxl' }))
vi.mock('../CreateContext', () => ({ useCreateExp: () => ({
  samplerList: [], schedulerList: [], loraList: [], vaeList: [], refreshModelLists: vi.fn(),
}) }))

afterEach(() => { cleanup(); host.mlx = false })

describe('Expert controls match the desktop backend', () => {
  it('hides the empty cloud image section', () => {
    useCreateStore.setState({ backend: 'cloud', mode: 'image' })
    useCreateStore.getState().setIntent('image')
    render(createElement(ParamGroups))
    expect(screen.queryByText('Expert')).toBeNull()
  })

  it('keeps working ComfyUI controls visible when expanded', () => {
    useCreateStore.setState({ backend: 'local', mode: 'image' })
    useCreateStore.getState().setIntent('image')
    render(createElement(ParamGroups))
    fireEvent.click(screen.getByText('Expert'))
    expect(screen.getByText('Sampler')).toBeTruthy()
    expect(screen.getByText('Scheduler')).toBeTruthy()
  })

  it('does not offer unsupported controls on MLX', () => {
    host.mlx = true
    useCreateStore.setState({ backend: 'local', mode: 'image' })
    useCreateStore.getState().setIntent('image')
    render(createElement(ParamGroups))
    expect(screen.queryByText('Expert')).toBeNull()
  })

  it('keeps cloud edit denoise while hiding local mask controls', () => {
    useCreateStore.setState({ backend: 'cloud', mode: 'image' })
    useCreateStore.getState().setIntent('edit')
    render(createElement(ParamGroups))
    fireEvent.click(screen.getByText('Expert'))
    expect(screen.getByText('Denoise (raw)')).toBeTruthy()
    expect(screen.queryByText('Mask edge feather')).toBeNull()
    expect(screen.queryByText('Sampler')).toBeNull()
  })
})
