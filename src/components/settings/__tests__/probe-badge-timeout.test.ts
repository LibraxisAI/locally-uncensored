import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// R8/T5 (2026-09-18): the Rust `system_health` probe now returns a third,
// non-error outcome -- `timeout` -- for a backend that accepted the
// connection but did not answer within the probe window (a cold-starting or
// busy local server), instead of folding it into `unreachable` ("Not
// running"), which told the owner of a live-but-slow backend to go restart
// something that was fine.
//
// `ProbeBadge` is not exported (it is one of many small components in the
// same big SettingsPage.tsx file, alongside ones that DO need the page's own
// context), so this pins the source text of the mapping tables directly --
// same technique `settings-update-and-keys.test.ts` already uses on this
// file. A TS render test would need to stand up the whole Troubleshoot
// section's dependencies for a three-line lookup table.
const src = readFileSync(resolve(__dirname, '../SettingsPage.tsx'), 'utf8')
const start = src.indexOf('function ProbeBadge')
const end = src.indexOf('function TroubleshootSection')
const probeBadge = src.slice(start, end)

describe('ProbeBadge renders the timeout status distinctly from unreachable/error/ok', () => {
  it('slices the function it inspects', () => {
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
  })

  it('the BackendProbe status type includes timeout', () => {
    const typeStart = src.indexOf('interface BackendProbe')
    const typeEnd = src.indexOf('interface SystemHealthReport')
    const backendProbeType = src.slice(typeStart, typeEnd)
    expect(backendProbeType).toMatch(/status:\s*'ok'\s*\|\s*'unreachable'\s*\|\s*'timeout'\s*\|\s*'not_installed'\s*\|\s*'error'/)
  })

  it('labels timeout as reachable-but-slow, never as "Not running"', () => {
    // `colors` and `labels` are two separate maps, each with its own
    // `timeout:` key -- scope the match to after `const labels` so this
    // reads the label string, not the color class from the earlier map.
    const labelsStart = probeBadge.indexOf('const labels')
    expect(labelsStart, 'no `const labels` map found').toBeGreaterThan(-1)
    const labelsSection = probeBadge.slice(labelsStart)
    const labelMatch = labelsSection.match(/timeout:\s*'([^']*)'/)
    expect(labelMatch, 'no `timeout:` entry in the labels map').not.toBeNull()
    const label = labelMatch![1]
    expect(label.toLowerCase()).toContain('slow to answer')
    expect(label).not.toBe('Not running')
  })

  it('colors timeout the same calm gray as unreachable, never amber/yellow, and always distinct from ok/error', () => {
    // `lib/hinweis.ts` HARTE REGEL (04.09.2026, guarded separately by
    // kein-gelb-in-der-oberflaeche.test.ts): exactly two tones exist, ruhig
    // (gray) and fehler (red) -- no third "in-between" color for a state
    // that is neither an error nor urgent. `unreachable`/`not_installed`
    // reuse a shared `RUHIG` constant rather than repeating the string
    // literal -- resolve it so the comparison is against the actual class
    // list, not the bare identifier.
    const ruhigMatch = probeBadge.match(/const RUHIG = '([^']*)'/)
    expect(ruhigMatch, 'RUHIG constant not found').not.toBeNull()
    const ruhig = ruhigMatch![1]

    const colorOf = (key: string): string => {
      const re = new RegExp(`${key}:\\s*(RUHIG|'[^']*')`)
      const m = probeBadge.match(re)
      expect(m, `no \`${key}:\` color entry`).not.toBeNull()
      const raw = m![1]
      return raw === 'RUHIG' ? ruhig : raw.slice(1, -1)
    }
    const timeoutColor = colorOf('timeout')
    expect(timeoutColor).toBe(colorOf('unreachable'))
    expect(timeoutColor).toBe(ruhig)
    expect(timeoutColor).not.toBe(colorOf('ok'))
    expect(timeoutColor).not.toBe(colorOf('error'))
    expect(timeoutColor).not.toMatch(/\b(?:amber|yellow)-/)
  })
})
