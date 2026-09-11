// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSettingsStore } from '../../../stores/settingsStore'
import { DEFAULT_SETTINGS } from '../../../lib/constants'
import { SAMPLING_CLOSE_LABEL, SAMPLING_DIALOG_LABEL, SamplingControls } from '../SamplingControls'

const settings = () => useSettingsStore.getState().settings
const trigger = () => screen.getByTestId('sampling-trigger')
const open = () => fireEvent.click(trigger())

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

  /**
   * Max tokens used to APPEND what you typed instead of replacing it: the box
   * showed 0, you typed 512, and `0512` stayed on screen (measured on the box,
   * T1 nebenfund 5). React keeps a controlled number input in step with a
   * loose comparison, so "0512" and the number 512 counted as equal and the
   * DOM was never corrected. Typed here one keystroke at a time, each one
   * appended to whatever the field really shows, because that is the gesture
   * that produced the wrong number.
   */
  const maxTokens = () => screen.getByLabelText('Max tokens') as HTMLInputElement
  const typeInto = (field: HTMLInputElement, chars: string) => {
    for (const c of chars) fireEvent.change(field, { target: { value: field.value + c } })
  }

  it('replaces what stands in max tokens instead of appending to it', () => {
    render(<SamplingControls />)
    open()
    const field = maxTokens()
    expect(field.value).toBe('0')
    typeInto(field, '512')
    expect(field.value).toBe('512')
    expect(settings().maxTokens).toBe(512)
  })

  it('falls back to the default when max tokens is cleared, and shows it again on blur', () => {
    useSettingsStore.getState().updateSettings({ maxTokens: 512 })
    render(<SamplingControls />)
    open()
    const field = maxTokens()
    fireEvent.change(field, { target: { value: '' } })
    expect(settings().maxTokens).toBe(DEFAULT_SETTINGS.maxTokens)
    expect(field.value).toBe('')
    fireEvent.blur(field)
    expect(field.value).toBe(String(DEFAULT_SETTINGS.maxTokens))
  })

  it('keeps max tokens a whole number, because a fraction is not a token count', () => {
    render(<SamplingControls />)
    open()
    fireEvent.change(maxTokens(), { target: { value: '512.7' } })
    expect(settings().maxTokens).toBe(512)
    expect(Number.isInteger(settings().maxTokens)).toBe(true)
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

/**
 * David, 2026-09-11: "der sample anklickbar im prompt fenster muss ein pop up
 * sein, und nicht das prompt fenster veraendern. mit einem sauberen x zum
 * wegklicken und nicht einfach wieder auf den text klicken zum entfernen, soll
 * windows mac und webapp ueberall gleich sein."
 *
 * The old panel was a sibling in the composer's flow, so opening it grew the
 * prompt window and pushed the text field down. jsdom has no layout at all
 * (every box measures 0), so a height comparison here would pass whatever the
 * component did. What jsdom CAN answer is the fact the layout follows from:
 * whether the panel is in the flow. The pixels are measured for real in
 * e2e/sampling-popup.spec.ts, against the bounding box of the composer row.
 */
describe('the sampling popup', () => {
  it('is a popup over the row, not a panel inside it', () => {
    render(<SamplingControls />)
    open()
    const panel = screen.getByTestId('sampling-panel')
    // Out of the flow: nothing around it can be moved by its height.
    expect(panel.style.position).toBe('absolute')
    // Anchored to the top edge of the trigger, so it opens upward over the
    // transcript and never downward into the send row.
    expect(panel.style.bottom).toBe('100%')
    expect(panel.getAttribute('role')).toBe('dialog')
    expect(panel.getAttribute('aria-label')).toBe(SAMPLING_DIALOG_LABEL)
  })

  it('says on the trigger whether it is open, and which panel it owns', () => {
    render(<SamplingControls />)
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    open()
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(trigger().getAttribute('aria-controls')).toBe(screen.getByTestId('sampling-panel').id)
  })

  it('closes on the X, which is what the X is for', () => {
    render(<SamplingControls />)
    open()
    fireEvent.click(screen.getByRole('button', { name: SAMPLING_CLOSE_LABEL }))
    expect(screen.queryByTestId('sampling-panel')).toBeNull()
  })

  it('closes on Escape', () => {
    render(<SamplingControls />)
    open()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('sampling-panel')).toBeNull()
  })

  it('closes on a press outside, the way a phone sends it', () => {
    render(<SamplingControls />)
    open()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByTestId('sampling-panel')).toBeNull()
  })

  it('stays open when its own contents are pressed', () => {
    render(<SamplingControls />)
    open()
    fireEvent.pointerDown(screen.getByTestId('sampling-panel'))
    expect(screen.queryByTestId('sampling-panel')).not.toBeNull()
  })

  // The half of David's sentence that is easiest to lose again: a trigger that
  // toggles makes the popup vanish under the pointer on the second press.
  it('does NOT close when the trigger is pressed a second time', () => {
    render(<SamplingControls />)
    open()
    open()
    expect(screen.getByTestId('sampling-panel')).toBeTruthy()
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
  })

  it('still holds the values after closing and opening again', () => {
    render(<SamplingControls />)
    open()
    fireEvent.change(screen.getByLabelText('Temperature'), { target: { value: '1.45' } })
    fireEvent.change(screen.getByLabelText('Max tokens'), { target: { value: '2048' } })
    fireEvent.click(screen.getByRole('button', { name: SAMPLING_CLOSE_LABEL }))
    open()
    expect((screen.getByLabelText('Temperature') as HTMLInputElement).value).toBe('1.45')
    expect((screen.getByLabelText('Max tokens') as HTMLInputElement).value).toBe('2048')
    expect(settings().temperature).toBe(1.45)
    expect(settings().maxTokens).toBe(2048)
  })

  it('takes the keyboard into the popup and hands it back to the trigger', () => {
    render(<SamplingControls />)
    open()
    const x = screen.getByRole('button', { name: SAMPLING_CLOSE_LABEL })
    expect(document.activeElement).toBe(x)
    fireEvent.click(x)
    expect(document.activeElement).toBe(trigger())
  })

  it('hands the keyboard back on Escape too', () => {
    render(<SamplingControls />)
    open()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(trigger())
  })
})
