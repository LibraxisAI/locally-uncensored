/**
 * K5 Nachbesserung (Opus review of `4fda5a0a`, Blockers 2 and 3): the
 * caption under the trainer's install-path field used to be one hardcoded
 * sentence that stayed on screen even once `trainer_root` was customized,
 * at which point it was false (Blocker 2), and it never said where base
 * model downloads actually go (Blocker 3, they follow the configured model
 * folder, not this field). `trainerRootHint` reads the real backend state
 * instead of assuming the default.
 */
import { describe, expect, it } from 'vitest'
import { trainerRootHint } from '../trainer-root-hint'

describe('trainerRootHint', () => {
  it('the default case: not customized, field empty', () => {
    const hint = trainerRootHint({ root: '/data/lu/musubi', customized: false }, '')
    expect(hint).toContain('Installs to your app data folder by default')
    expect(hint).toContain('configured model folder')
  })

  it('THE FIX: a customized root is named, not the generic default sentence', () => {
    const hint = trainerRootHint({ root: 'E:\\LU-Trainer', customized: true }, 'E:\\LU-Trainer')
    expect(hint).toContain('E:\\LU-Trainer')
    expect(hint).not.toContain('Installs to your app data folder by default')
  })

  it('GEGENPROBE: the old bug -- claiming the default while a customized root is active -- cannot happen', () => {
    // Blocker 2's exact failure: a broken customized install re-shows this
    // gate, and the caption must not say "app data folder" while `root`
    // still names the customer's own drive.
    const hint = trainerRootHint({ root: 'E:\\LU-Trainer', customized: true }, 'E:\\LU-Trainer')
    expect(hint.includes('app data folder by default')).toBe(false)
  })

  it('point 3, the way back: clearing a customized field explains what pressing Set up trainer will do', () => {
    const hint = trainerRootHint({ root: 'E:\\LU-Trainer', customized: true }, '')
    expect(hint).toContain('installs to your app data folder instead')
  })

  it('point 4, no silent orphan: the old files are named as kept, not deleted', () => {
    const hint = trainerRootHint({ root: 'E:\\LU-Trainer', customized: true }, '')
    expect(hint).toContain('E:\\LU-Trainer')
    expect(hint).toContain('are kept, not deleted')
  })

  it('Blocker 3, every branch names where base models actually go', () => {
    for (const [status, value] of [
      [{ root: '/data/lu/musubi', customized: false }, ''],
      [{ root: 'E:\\LU-Trainer', customized: true }, 'E:\\LU-Trainer'],
      [{ root: 'E:\\LU-Trainer', customized: true }, ''],
    ] as const) {
      expect(trainerRootHint(status, value)).toContain('configured model folder')
    }
  })
})
