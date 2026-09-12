// @vitest-environment jsdom
/**
 * Die Marken sagen in beiden Apps dasselbe: unzensiert nur gemessen und nur
 * ganz, die Freimenge nur fuer ein Konto, das dafuer zahlt.
 *
 * R5-17: die Zeile zeichnete die Freimengenmarke ohne jede Kontoabfrage. Der
 * Server liefert `flash` an JEDES Konto mit Cloud, abgerechnet wird aber nach
 * `accountPlanPays`. Ein Starter-Konto, das nie gezahlt hat, las damit eine
 * Zusage und bekam die Rechnung.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ModelRowMarks } from '../ModelRowMarks'
import { FLASH_MARK_LABEL } from '../../../lib/flash-entitlement'
import { useCloudAuthStore } from '../../../stores/cloudAuthStore'

const flash = { dailyTokens: 500_000, defaultMaxOutput: 8192, requestSeconds: 240, billingKey: 'k' }

const signIn = (paidPlan: boolean | null) =>
  useCloudAuthStore.getState().setSignedIn(
    { id: 'u1' },
    { licenseActive: true, tier: 'hosted', access: true, quota: null, paidPlan },
  )

beforeEach(() => {
  cleanup()
  useCloudAuthStore.getState().setSignedOut()
})

describe('ModelRowMarks', () => {
  it('marks a measured, fully unfiltered model regardless of the plan', () => {
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
    signIn(true)
    render(<ModelRowMarks model={{ flash }} />)
    expect(screen.getByText(FLASH_MARK_LABEL).getAttribute('title')).toContain('500,000')
  })

  it('carries both marks at once for a paying account', () => {
    signIn(true)
    render(<ModelRowMarks model={{ flash, unfiltered: 'full' }} />)
    expect(screen.getByText('No refusals')).toBeTruthy()
    expect(screen.getByText(FLASH_MARK_LABEL)).toBeTruthy()
  })

  it('promises nothing to an account that pays for these very models', () => {
    signIn(false)
    render(<ModelRowMarks model={{ flash, unfiltered: 'full' }} />)
    expect(screen.queryByText(FLASH_MARK_LABEL)).toBeNull()
    expect(screen.queryByText('No credits')).toBeNull()
    // Die gemessene Marke haengt nicht am Geld und bleibt stehen.
    expect(screen.getByText('No refusals')).toBeTruthy()
  })

  it('promises nothing while the account probe has not answered', () => {
    signIn(null)
    render(<ModelRowMarks model={{ flash }} />)
    expect(screen.queryByText(FLASH_MARK_LABEL)).toBeNull()
  })

  it('shows nothing at all for a model without the free class', () => {
    signIn(true)
    render(<ModelRowMarks model={{}} />)
    expect(screen.queryByText(FLASH_MARK_LABEL)).toBeNull()
    expect(screen.queryByText('No refusals')).toBeNull()
  })
})
