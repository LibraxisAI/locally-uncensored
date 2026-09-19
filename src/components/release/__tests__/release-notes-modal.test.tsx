// @vitest-environment jsdom
/**
 * Redesign guard (Bauer, 19.09.2026): David asked for the sheet to carry the
 * real house logo instead of a pulsing gradient square, to lose the Sparkles
 * icon and every other decorative "magic" glyph, and to keep working for an
 * entry written before groups existed. Four things are pinned here so a later
 * edit cannot quietly bring any of them back:
 *
 *   1. the header renders the actual monogram asset, not a fabricated shape
 *   2. no decorative icon from lucide-react is imported into the sheet
 *   3. a `details` table with several named sections renders each of them
 *   4. an old, flat entry (no `details` at all) still renders without it
 *
 * `ReleaseNoteBody` is exported separately from `ReleaseNotesModal` so these
 * can render an arbitrary note without wiring up the four stores the smart
 * component reads from.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReleaseNoteBody, ReleaseNotesModal } from '../ReleaseNotesModal'
import { MONOGRAM } from '../../layout/brand'
import { useReleaseNotesStore } from '../../../stores/releaseNotesStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import type { ReleaseNote } from '../../../lib/release-notes'

const SRC = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../ReleaseNotesModal.tsx'),
  'utf8',
)

describe('the sheet carries the real logo, not a decoration', () => {
  it('imports the house monogram from layout/brand, the same file every other surface uses', () => {
    expect(SRC).toContain("from '../layout/brand'")
    expect(SRC).toContain('MONOGRAM')
  })

  it('renders that exact asset as an <img>, with no fabricated shape standing in for it', () => {
    const note: ReleaseNote = { version: '9.9.9', headline: 'Test headline for the render check.', lines: ['One line.', 'Two line.'] }
    render(<ReleaseNoteBody note={note} onClose={() => {}} />)
    const img = document.querySelector('img')
    expect(img?.getAttribute('src')).toBe(MONOGRAM)
  })

  it('imports no decorative icon: no Sparkles, wand, stars, confetti or gem', () => {
    // Not an exhaustive icon blacklist — the ones that actually turned up on
    // this sheet and its siblings (CloudTeaserModal) before this pass.
    const banned = ['Sparkles', 'Sparkle', 'Wand', 'Wand2', 'Stars', 'PartyPopper', 'Gem', 'Rainbow']
    const importLine = SRC.split('\n').find((l) => l.includes("from 'lucide-react'")) ?? ''
    for (const name of banned) {
      expect(importLine, `${name} is imported from lucide-react`).not.toMatch(new RegExp(`\\b${name}\\b`))
    }
  })

  it('renders no animated demo shape: no gradient square standing in for the update', () => {
    expect(SRC).not.toContain('gradient-to-br')
    expect(SRC).not.toContain('UpdateDemo')
  })
})

describe('grouped changes', () => {
  const withGroups: ReleaseNote = {
    version: '9.9.9',
    headline: 'Test headline for the grouping check.',
    lines: ['A summary line.', 'Another summary line.'],
    details: [
      { title: 'Engine and hardware', items: ['Engine item one.', 'Engine item two.'] },
      { title: 'Create', items: ['Create item one.'] },
    ],
  }

  it('offers the expander and lists every section title once expanded', () => {
    render(<ReleaseNoteBody note={withGroups} onClose={() => {}} />)
    expect(screen.queryByText('Engine and hardware')).toBeNull()
    fireEvent.click(screen.getByText('Show all changes'))
    expect(screen.getByText('Engine and hardware')).toBeTruthy()
    expect(screen.getByText('Create')).toBeTruthy()
    expect(screen.getByText('Engine item one.')).toBeTruthy()
    expect(screen.getByText('Create item one.')).toBeTruthy()
  })

  it('an old, flat entry with no details renders fine and offers no expander', () => {
    const flat: ReleaseNote = {
      version: '2.0.0',
      headline: 'An old headline, written before groups existed.',
      lines: ['Old line one.', 'Old line two.'],
    }
    render(<ReleaseNoteBody note={flat} onClose={() => {}} />)
    expect(screen.getByText('Old line one.')).toBeTruthy()
    expect(screen.queryByText('Show all changes')).toBeNull()
  })
})

describe('closing', () => {
  it('the Got it button calls onClose', () => {
    const onClose = vi.fn()
    const note: ReleaseNote = { version: '9.9.9', headline: 'Headline for the close check.', lines: ['One line.', 'Two line.'] }
    render(<ReleaseNoteBody note={note} onClose={onClose} />)
    fireEvent.click(screen.getByText('Got it'))
    expect(onClose).toHaveBeenCalledTimes(1)
    cleanup()
  })
})

describe('the wired-up sheet, end to end', () => {
  beforeEach(() => {
    cleanup()
    useReleaseNotesStore.setState({ lastNotesVersion: null })
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, onboardingDone: true } }))
  })

  it('opens for the shipping version and Escape closes it, stamping the version so it does not return', async () => {
    render(<ReleaseNotesModal />)
    // package.json pins the running version to 3.0.1, and RELEASE_NOTES
    // carries an entry for it, so the sheet is open on mount.
    await waitFor(() => expect(screen.getByText('What is new')).toBeTruthy())
    expect(useReleaseNotesStore.getState().lastNotesVersion).not.toBe('3.0.1')

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(useReleaseNotesStore.getState().lastNotesVersion).toBe('3.0.1'))
    await waitFor(() => expect(screen.queryByText('What is new')).toBeNull())
  })
})
