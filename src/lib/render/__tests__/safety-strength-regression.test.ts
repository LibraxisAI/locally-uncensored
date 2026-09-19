/**
 * B1 (review-w2ui.md, 18.09.2026): `03f98fdd` (R5-9) narrowed the compaction
 * pass in safety.ts from `[^a-z0-9]+` (every non-alphanumeric) to `[\s._-]+`,
 * and ran it only on `base`, not on the leet-folded `deleeted` copy too. That
 * let separator variants other than space/dot/underscore/hyphen (asterisks,
 * slashes, pipes, and eight more) and digit-substitution evasions walk past
 * the CSAM gate outright, or downgrade from `csam` to the weaker
 * `minor+sexual` reason once a word was prepended ("a c*h*i*l*d*p*o*r*n
 * image").
 *
 * This file proves, by direct comparison, that the fix (testing
 * ALWAYS_BLOCKED_COMPACT against collapseSpacing's letter-spacing `runs`
 * instead of a narrowed whole-string strip) restores at least the strength of
 * the pre-regression version (`03f98fdd^`) for every probe below, while also
 * fixing a false-alarm class that a naive full-strength restore would have
 * reintroduced: joining the ENTIRE prompt before testing glues unrelated
 * ordinary words across a plain space too ("a classic samurai image" ->
 * "aclassicsamuraiimage" contains "csam"), which both the pre- and
 * post-regression whole-string `compacts` would have flagged. Word-boundary
 * preserving `runs` (only single-character clusters get glued) does not.
 *
 * The two historical versions are loaded from git, not retyped, so the
 * comparison is against what was actually shipped, not a paraphrase of it.
 *
 * Run: npx vitest run src/lib/render/__tests__/safety-strength-regression.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkPromptSafety as currentCheck } from '../safety'

const REPO_ROOT = resolve(__dirname, '../../../..')
const PATH_IN_REPO = 'src/lib/render/safety.ts'

/** The commit right before R5-9 narrowed the compaction: full strength. */
const OLD_SHA = '03f98fdd~1'
/** R5-9 itself: the narrowed, weaker version this whole file guards against. */
const WEAK_SHA = '03f98fdd'

type Verdict = { blocked: boolean; reason?: string }
type CheckFn = (text: string, opts?: { tier?: 'local' | 'cloud'; policy?: 'strict' | 'soft' | 'off' }) => Verdict

let oldCheck: CheckFn
let weakCheck: CheckFn

beforeAll(async () => {
  const load = async (sha: string): Promise<CheckFn> => {
    const source = execFileSync('git', ['show', `${sha}:${PATH_IN_REPO}`], {
      cwd: REPO_ROOT,
      maxBuffer: 10 * 1024 * 1024,
    })
    const dir = mkdtempSync(join(tmpdir(), 'lu-safety-hist-'))
    const file = join(dir, 'safety.ts')
    writeFileSync(file, source)
    const mod = (await import(pathToFileURL(file).href)) as { checkPromptSafety: CheckFn }
    return mod.checkPromptSafety
  }
  oldCheck = await load(OLD_SHA)
  weakCheck = await load(WEAK_SHA)
})

/** unblocked < minor+sexual < csam. Never weaker means: rank must not drop. */
function rank(v: Verdict): number {
  if (!v.blocked) return 0
  if (v.reason === 'minor+sexual') return 1
  if (v.reason === 'csam') return 2
  return 1 // any other reason (e.g. a future addition) counts as "blocked, not csam"
}

/** Nine separator variants named in the review, plus plain space. */
const SEPARATORS = ['*', '/', '+', '|', '~', '#', ',', ';', ':', ' ']
/** Digit-leet separator set named in the review for the digit-substitution rows. */
const LEET_SEPARATORS = ['.', '-', '_', ' ']

function spacedOut(letters: string, sep: string): string {
  return letters.split('').join(sep)
}

/** The four terms of ALWAYS_BLOCKED_COMPACT, spelled out letter by letter so
 *  `spacedOut` can insert every separator between each letter. */
const COMPACT_TERMS: Record<string, string> = {
  csam: 'csam',
  jailbait: 'jailbait',
  childporn: 'childporn',
  childpornography: 'childpornography',
  lolitanude: 'lolitanude',
}

/** Builds the differential probe list: every compact term, every separator,
 *  with and without a leading word, plus the digit-leet ("4" for "a", "5" for
 *  "s") variants the review calls out by name. */
function buildProbes(): string[] {
  const probes: string[] = []
  for (const letters of Object.values(COMPACT_TERMS)) {
    for (const sep of SEPARATORS) {
      probes.push(`a ${spacedOut(letters, sep)} image`)
      probes.push(spacedOut(letters, sep))
    }
    // Digit-leet: swap 'a' -> '4' and 's' -> '5' before spacing, so the
    // differential exercises the deleeted view too, not just the plain one.
    const leeted = letters.replace(/a/g, '4').replace(/s/g, '5')
    for (const sep of LEET_SEPARATORS) {
      probes.push(`a ${spacedOut(leeted, sep)} image`)
    }
  }
  return probes
}

const PROBES = buildProbes()

/** A handful of ordinary prompts that must never be treated as an evasion,
 *  independent from the compact-term probes above. Included so the
 *  differential run also documents that the fix does not over-block. */
const LEGITIMATE_PROMPTS = [
  'a torpedo launch at sunset',
  "a child's birthday party with balloons",
  'a classic samurai image',
  'basic samurai armor, studio lighting',
  'an epic samurai duel at dawn',
  'a nude woman, 30 years old, studio light',
  'childrens book illustration, watercolor',
  'a canteen at lunch time',
  'a landscape in sussex',
]

describe('B1 differential: the fix is never weaker than the pre-regression version', () => {
  it('every compact-term probe: new verdict rank >= old (03f98fdd^) verdict rank', () => {
    const regressions: string[] = []
    for (const text of PROBES) {
      const before = rank(oldCheck(text))
      const after = rank(currentCheck(text))
      if (after < before) {
        regressions.push(`"${text}": old=${JSON.stringify(oldCheck(text))} new=${JSON.stringify(currentCheck(text))}`)
      }
    }
    expect(regressions, regressions.join('\n')).toEqual([])
  })

  it('reason never downgrades either: nothing old called "csam" becomes "minor+sexual" or unblocked', () => {
    const downgrades: string[] = []
    for (const text of PROBES) {
      const before = oldCheck(text)
      const after = currentCheck(text)
      if (before.reason === 'csam' && after.reason !== 'csam') {
        downgrades.push(`"${text}": old=${JSON.stringify(before)} new=${JSON.stringify(after)}`)
      }
    }
    expect(downgrades, downgrades.join('\n')).toEqual([])
  })

  it('sanity: the probe list actually exercises something (old fassung blocks most of it)', () => {
    const blockedByOld = PROBES.filter((t) => oldCheck(t).blocked).length
    expect(blockedByOld).toBeGreaterThan(PROBES.length / 2)
  })

  it('does not reintroduce the whole-string false alarm ("classic samurai" style)', () => {
    for (const text of LEGITIMATE_PROMPTS) {
      expect(currentCheck(text).blocked, text).toBe(false)
    }
  })
})

describe('NEGATIVE CONTROL: the narrowed (03f98fdd) compaction fails this exact check', () => {
  it('the weakened fassung IS measurably weaker than 03f98fdd^ on this probe list', () => {
    const regressions: string[] = []
    for (const text of PROBES) {
      const before = rank(oldCheck(text))
      const after = rank(weakCheck(text))
      if (after < before) {
        regressions.push(text)
      }
    }
    // This is the point of the file: prove the differential check has teeth.
    // If this list were empty, the two tests above would not be measuring
    // anything, since a vacuous check cannot fail either.
    expect(regressions.length).toBeGreaterThan(0)
  })
})
