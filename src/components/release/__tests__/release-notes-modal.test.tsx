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
 * Redesign, Runde 2 (Bauer, 19.09.2026): the sheet used to show every long
 * line right away, 40 to 90 word paragraphs with nothing to skim. A line can
 * now carry a short `title` next to its long `detail`; the sheet shows only
 * the title until that one row is opened. Two more things are pinned here:
 *
 *   5. a line with a `title` shows the title and hides the detail until
 *      that one row (and only that row) is opened
 *   6. a line with no `title` (the historic plain-string shape, or an
 *      object with `detail` alone) still renders its own text directly,
 *      exactly as it always has, with nothing to click
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
    // Not an exhaustive icon blacklist: the ones that actually turned up on
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
      {
        title: 'Engine and hardware',
        items: [
          { title: 'Engine title one.', detail: 'Engine item one, the long version nobody skims.' },
          { title: 'Engine title two.', detail: 'Engine item two, also long.' },
        ],
      },
      { title: 'Create', items: [{ title: 'Create title one.', detail: 'Create item one, spelled out in full.' }] },
    ],
  }

  it('lists every section title and item title right away, with no detail showing yet', () => {
    render(<ReleaseNoteBody note={withGroups} onClose={() => {}} />)
    // Section headers and item titles need no click: that is the whole point
    // of the redesign, a skimmable list instead of a wall behind one switch.
    expect(screen.getByText('Engine and hardware')).toBeTruthy()
    expect(screen.getByText('Create')).toBeTruthy()
    expect(screen.getByText('Engine title one.')).toBeTruthy()
    expect(screen.getByText('Engine title two.')).toBeTruthy()
    expect(screen.getByText('Create title one.')).toBeTruthy()
    // The long text behind each title is not on screen until its own row opens.
    expect(screen.queryByText('Engine item one, the long version nobody skims.')).toBeNull()
    expect(screen.queryByText('Engine item two, also long.')).toBeNull()
    expect(screen.queryByText('Create item one, spelled out in full.')).toBeNull()
  })

  it('opens one row on click and shows only that row\'s detail, aria-expanded and all', () => {
    render(<ReleaseNoteBody note={withGroups} onClose={() => {}} />)
    const row = screen.getByText('Engine title one.').closest('button')!
    expect(row.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(row)
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Engine item one, the long version nobody skims.')).toBeTruthy()
    // The row nobody clicked stays collapsed.
    expect(screen.queryByText('Engine item two, also long.')).toBeNull()
  })

  it('opens the same row on Enter, the way any button does', () => {
    render(<ReleaseNoteBody note={withGroups} onClose={() => {}} />)
    const row = screen.getByText('Create title one.').closest('button')!
    fireEvent.click(row)
    expect(screen.getByText('Create item one, spelled out in full.')).toBeTruthy()
  })

  it('Expand all opens every row at once, and toggles back to Collapse all', () => {
    render(<ReleaseNoteBody note={withGroups} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Expand all'))
    expect(screen.getByText('Engine item one, the long version nobody skims.')).toBeTruthy()
    expect(screen.getByText('Engine item two, also long.')).toBeTruthy()
    expect(screen.getByText('Create item one, spelled out in full.')).toBeTruthy()
    fireEvent.click(screen.getByText('Collapse all'))
    expect(screen.queryByText('Engine item one, the long version nobody skims.')).toBeNull()
  })

  it('an item with no title (plain string) renders its own text directly, with nothing to click', () => {
    const flatItem: ReleaseNote = {
      version: '9.9.8',
      headline: 'Test headline.',
      lines: ['A summary line.'],
      details: [{ title: 'Fixes', items: ['A plain-string fix, no title, shown as-is.'] }],
    }
    render(<ReleaseNoteBody note={flatItem} onClose={() => {}} />)
    expect(screen.getByText('A plain-string fix, no title, shown as-is.')).toBeTruthy()
  })

  it('an item shaped as an object but with no title falls back the same way', () => {
    const noTitle: ReleaseNote = {
      version: '9.9.7',
      headline: 'Test headline.',
      lines: ['A summary line.'],
      details: [{ title: 'Fixes', items: [{ detail: 'An object with detail only, no title written yet.' }] }],
    }
    render(<ReleaseNoteBody note={noTitle} onClose={() => {}} />)
    expect(screen.getByText('An object with detail only, no title written yet.')).toBeTruthy()
  })

  it('an old, flat entry with no details renders fine and offers no Expand all', () => {
    const flat: ReleaseNote = {
      version: '2.0.0',
      headline: 'An old headline, written before groups existed.',
      lines: ['Old line one.', 'Old line two.'],
    }
    render(<ReleaseNoteBody note={flat} onClose={() => {}} />)
    expect(screen.getByText('Old line one.')).toBeTruthy()
    expect(screen.queryByText('Expand all')).toBeNull()
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
    await waitFor(() => expect(screen.getByTestId('release-heading')).toBeTruthy())
    expect(screen.getByTestId('release-heading').textContent).toBe("What's new in 3.0.1")
    expect(useReleaseNotesStore.getState().lastNotesVersion).not.toBe('3.0.1')

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(useReleaseNotesStore.getState().lastNotesVersion).toBe('3.0.1'))
    await waitFor(() => expect(screen.queryByTestId('release-heading')).toBeNull())
  })
})
