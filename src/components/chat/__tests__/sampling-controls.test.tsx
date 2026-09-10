// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSettingsStore } from '../../../stores/settingsStore'
import { DEFAULT_SETTINGS } from '../../../lib/constants'
import { SamplingControls } from '../SamplingControls'

const settings = () => useSettingsStore.getState().settings
const open = () => fireEvent.click(screen.getByRole('button', { name: /Sampling/ }))

beforeEach(() => {
  cleanup()
  useSettingsStore.getState().updateSettings({
    temperature: DEFAULT_SETTINGS.temperature,
    topP: DEFAULT_SETTINGS.topP,
    topK: DEFAULT_SETTINGS.topK,
    maxTokens: DEFAULT_SETTINGS.maxTokens,
  })
})

describe('SamplingControls', () => {
  it('stays collapsed until asked, so the composer stays quiet', () => {
    render(<SamplingControls />)
    expect(screen.queryByTestId('sampling-panel')).toBeNull()
    open()
    expect(screen.getByTestId('sampling-panel')).toBeTruthy()
  })

  it('shows the live temperature on the closed control', () => {
    useSettingsStore.getState().updateSettings({ temperature: 1.15 })
    render(<SamplingControls />)
    expect(screen.getByRole('button', { name: /1\.15/ })).toBeTruthy()
  })

  it('writes each value into the settings the request already reads', () => {
    render(<SamplingControls />)
    open()
    fireEvent.change(screen.getByLabelText('Temperature'), { target: { value: '1.3' } })
    fireEvent.change(screen.getByLabelText('Top P'), { target: { value: '0.5' } })
    fireEvent.change(screen.getByLabelText('Top K'), { target: { value: '20' } })
    expect(settings().temperature).toBe(1.3)
    expect(settings().topP).toBe(0.5)
    expect(settings().topK).toBe(20)
  })

  it('never lets max tokens go negative', () => {
    render(<SamplingControls />)
    open()
    fireEvent.change(screen.getByLabelText('Max tokens'), { target: { value: '-500' } })
    expect(settings().maxTokens).toBe(0)
  })

  it('marks a changed setup and resets every field at once', () => {
    useSettingsStore.getState().updateSettings({ temperature: 1.9, topK: 5 })
    render(<SamplingControls />)
    expect(screen.getByTitle(/Changed from the defaults/)).toBeTruthy()
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(settings().temperature).toBe(DEFAULT_SETTINGS.temperature)
    expect(settings().topK).toBe(DEFAULT_SETTINGS.topK)
    expect(screen.queryByTitle(/Changed from the defaults/)).toBeNull()
  })

  it('offers no reset while everything is at its default', () => {
    render(<SamplingControls />)
    open()
    expect((screen.getByRole('button', { name: 'Reset' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('says plainly that reasoning models react less, instead of hiding the control', () => {
    render(<SamplingControls />)
    open()
    expect(screen.getByText(/Reasoning models accept these/)).toBeTruthy()
  })
})
