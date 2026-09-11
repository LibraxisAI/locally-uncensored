// @vitest-environment jsdom
/**
 * Die Marken sagen in beiden Apps dasselbe: unzensiert nur gemessen und nur
 * ganz, ohne Credits mit der echten Tageszahl.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ModelRowMarks } from '../ModelRowMarks'

const flash = { dailyTokens: 500_000, defaultMaxOutput: 8192, requestSeconds: 240, billingKey: 'k' }

beforeEach(() => cleanup())

describe('ModelRowMarks', () => {
  it('marks a measured, fully unfiltered model', () => {
    render(<ModelRowMarks model={{ unfiltered: 'full' }} />)
    expect(screen.getByText('No refusals')).toBeTruthy()
  })

  it('stays silent on partial and on a model with nothing measured', () => {
    for (const unfiltered of ['partial', undefined] as const) {
      cleanup()
      render(<ModelRowMarks model={{ unfiltered }} />)
      expect(screen.queryByText('No refusals')).toBeNull()
    }
  })

  it('names the daily number the server sent, never a number of its own', () => {
    render(<ModelRowMarks model={{ flash }} />)
    expect(screen.getByText('No credits').getAttribute('title')).toContain('500,000')
  })

  it('carries both marks at once', () => {
    render(<ModelRowMarks model={{ flash, unfiltered: 'full' }} />)
    expect(screen.getByText('No refusals')).toBeTruthy()
    expect(screen.getByText('No credits')).toBeTruthy()
  })
})
