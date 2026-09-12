// @vitest-environment jsdom
/**
 * R5-30, Entscheid David vom 12.09.2026: der Desktop bekommt den Altpfad fuer
 * alte Cloud-Erinnerungen, den bis dahin nur das Web hatte.
 *
 * Vor dem heutigen Protokoll lag die Kontosammlung als EIN Blob in der Wolke.
 * Das Web konnte ihn ansehen und entfernen, der Desktop nicht, also blieb er
 * dort liegen, wo der Kunde ihn nie zu Gesicht bekam, und eine aeltere Fassung
 * der App konnte weiter aus ihm lesen.
 *
 * Die Reihenfolge ist der eigentliche Schutz: ansehen, Haekchen, entfernen.
 * Der Knopf zum Entfernen bleibt bis dahin tot.
 *
 * Run: npx vitest run src/components/settings/__tests__/der-altpfad-steht-auch-im-desktop.test.tsx
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../../../api/backend', () => ({
  backendCall: vi.fn(async () => null), isTauri: () => false, isMacOS: () => false, openExternal: vi.fn(),
}))

const befund = {
  owner: 'konto-1', collectionRevision: 0, entries: [],
  previous: [{ id: 'alt-1', content: 'aus der alten Kopie' }],
  current: [{ memory_id: 'alt-1', revision: 4, deleted: false, payload: { id: 'alt-1' }, updated_at: 'x' }],
}
const angesehen = vi.fn(async () => befund)
const entfernt = vi.fn(async () => {})
vi.mock('../../../lib/memory-legacy', () => ({
  reviewPreviousMemories: (...args: unknown[]) => angesehen(...(args as [])),
  finalizePreviousMemories: (...args: unknown[]) => entfernt(...(args as [])),
}))

const { MemorySettings } = await import('../MemorySettings')
const { useMemoryStore } = await import('../../../stores/memoryStore')

const zustimmen = () => fireEvent.click(screen.getByLabelText('Allow cloud storage for this account collection'))

beforeEach(() => {
  angesehen.mockClear(); entfernt.mockClear()
  useMemoryStore.setState({ entries: [], activeMemoryOwner: 'konto-1', memoryCollectionRevision: 0 })
})
afterEach(() => { cleanup(); useMemoryStore.setState({ activeMemoryOwner: null }) })

describe('der Altpfad in den Erinnerungseinstellungen', () => {
  it('sieht erst nach, zeigt den Befund und entfernt erst mit Haekchen', async () => {
    render(<MemorySettings />)
    zustimmen()

    fireEvent.click(screen.getByText('Check old memory copy'))
    await waitFor(() => expect(angesehen).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('status').textContent)
      .toBe('Review both versions before removing the previous cloud copy.')
    const entfernen = screen.getByText('Remove old copy') as HTMLButtonElement
    expect(entfernen.disabled, 'entfernen war ohne Haekchen anklickbar').toBe(true)

    fireEvent.click(entfernen)
    expect(entfernt, 'ein toter Knopf hat trotzdem entfernt').not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText(/I reviewed these versions and confirm removing the previous cloud copy/))
    expect((screen.getByText('Remove old copy') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByText('Remove old copy'))
    await waitFor(() => expect(entfernt).toHaveBeenCalledTimes(1))
    expect(entfernt.mock.calls[0][0]).toBe(befund)
    expect(entfernt.mock.calls[0][1]).toBe(true)
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(
      'Previous cloud copy removed. Older versions can no longer synchronize memories. Conversations keep synchronizing.',
    ))
    expect(screen.queryByText('Remove old copy'), 'der Befund steht nach dem Entfernen noch da').toBeNull()
  })

  it('fragt ohne Zustimmung zur Wolke gar nicht erst nach', () => {
    // Negativkontrolle: derselbe Riegel wie am Synchronisierungslauf. Ohne das
    // Haekchen zur Wolkenspeicherung geht keine Anfrage raus.
    render(<MemorySettings />)
    const nachsehen = screen.getByText('Check old memory copy') as HTMLButtonElement
    expect(nachsehen.disabled).toBe(true)
    fireEvent.click(nachsehen)
    expect(angesehen).not.toHaveBeenCalled()
  })

  it('zeigt den Altpfad nur bei einer Kontosammlung', () => {
    cleanup()
    useMemoryStore.setState({ activeMemoryOwner: null })
    render(<MemorySettings />)
    expect(screen.queryByText('Check old memory copy')).toBeNull()
  })
})
