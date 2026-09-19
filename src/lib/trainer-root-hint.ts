import type { TrainerStatus } from '../api/trainer'

/**
 * The sentence under the trainer's install-path field.
 *
 * K5 Blockers 2 and 3 (Opus review of `4fda5a0a`): the old sentence was one
 * hardcoded claim, "Installs to your app data folder by default", that
 * stayed on screen even after a customer had a customized `trainer_root` --
 * at that point it was false, and pressing "Set up trainer" in the belief it
 * went to app data reinstalled at the customized (possibly now unplugged)
 * drive instead, with no way back through the field. This reads the CURRENT
 * backend state instead of assuming the default, always names where the two
 * things that land here actually go (Blocker 3: the trainer's own
 * environment and caches follow this field, base model downloads always go
 * to the configured model folder in Settings, regardless of it), and says
 * plainly that clearing the field is the way back and nothing at the old
 * location is deleted (point 4).
 */
export function trainerRootHint(
  status: Pick<TrainerStatus, 'root' | 'customized'>,
  fieldValue: string,
): string {
  const trimmed = fieldValue.trim()
  const baseModels = 'Base model downloads always go to your configured model folder (Settings, ComfyUI), not here.'
  if (status.customized && trimmed === '') {
    return `Leaving this empty and pressing Set up trainer installs to your app data folder instead. Files already at ${status.root} are kept, not deleted. ${baseModels}`
  }
  if (status.customized) {
    return `Installs to ${status.root}. Clear this field to go back to the app data folder. ${baseModels}`
  }
  return `Installs to your app data folder by default. Set a path above to use another drive. ${baseModels}`
}
