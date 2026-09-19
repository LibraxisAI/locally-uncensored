// "What is new" sheet, shown once after an update (B4, David 2026-08-04).
//
// Redesign (Bauer, 19.09.2026): the borrowed pulsing gradient square and the
// Sparkles icon are gone. The header carries the real house monogram from
// `layout/brand.ts`, the same vector every other surface in the app uses, so
// the sheet reads as part of the program instead of a shape pasted over it.
// The dialog itself now goes through the shared `ui/Modal`: a real dialog
// role, a focus trap that returns focus on close, Escape, and the app's own
// prefers-reduced-motion cascade, instead of a second hand-rolled copy of
// all four. The surface moves off the undocumented literal `#232323` onto
// the app's own near-black tokens (`lu-base`, `lu-canvas`), and the one
// accent colour is `lu-accent`, the house's own, not a plain Tailwind violet.
//
// `ReleaseNoteBody` is exported on its own so a test can render an arbitrary
// note (with or without `details`, with or without a `cloud` block) without
// wiring up every store this file reads from.

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { MONOGRAM, MONOGRAM_INVERT } from '../layout/brand'
import { version as currentVersion } from '../../../package.json'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore } from '../../stores/uiStore'
import { useCloudAuthStore, deriveCloudAvailable } from '../../stores/cloudAuthStore'
import { useReleaseNotesStore, shouldShowReleaseNotes } from '../../stores/releaseNotesStore'
import { releaseNoteFor, type ReleaseNote } from '../../lib/release-notes'

export function ReleaseNotesModal() {
  const lastNotesVersion = useReleaseNotesStore((s) => s.lastNotesVersion)
  const markNotesSeen = useReleaseNotesStore((s) => s.markNotesSeen)
  const onboardingDone = useSettingsStore((s) => s.settings.onboardingDone)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const setCloudGateOpen = useUIStore((s) => s.setCloudGateOpen)
  const cloudAvailable = useCloudAuthStore(deriveCloudAvailable)

  const open = shouldShowReleaseNotes(currentVersion, lastNotesVersion, onboardingDone)
  const note = releaseNoteFor(currentVersion)
  const close = () => markNotesSeen(currentVersion)

  /**
   * Der Knopf des Cloud-Blocks.
   *
   * Er tut genau das, was der Wolkenschalter im Kopf der App tut, und faellt
   * darum auf dieselbe Unterscheidung zurueck: ein Konto, das die Wolke nutzen
   * darf, wird umgeschaltet; jedes andere bekommt das Verkaufs-Panel. Kein
   * zweiter Weg in die Wolke, nur ein zweiter Ausloeser.
   *
   * Das Blatt schliesst sich dabei, sonst laege es ueber dem, was es gerade
   * geoeffnet hat. Es gilt danach als gelesen, denn der Kunde hat es gelesen.
   */
  const turnOnCloud = () => {
    close()
    if (cloudAvailable) updateSettings({ appMode: 'cloud' })
    else setCloudGateOpen(true)
  }

  if (!note) return null

  return (
    <Modal
      open={open}
      onClose={close}
      title={`What's new in ${note.version}`}
      hideHeader
      maxWidth="max-w-[420px]"
      panelPad="p-0"
    >
      <ReleaseNoteBody note={note} onClose={close} onTurnOnCloud={turnOnCloud} />
    </Modal>
  )
}

interface ReleaseNoteBodyProps {
  note: ReleaseNote
  onClose: () => void
  /** Absent when the note carries no `cloud` block; the button never renders then. */
  onTurnOnCloud?: () => void
}

/** The sheet's own content, independent of `Modal` and every store above it. */
export function ReleaseNoteBody({ note, onClose, onTurnOnCloud }: ReleaseNoteBodyProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="flex flex-col max-h-[85vh] rounded-2xl overflow-hidden bg-lu-base">
      {/* Header: the real monogram, never a Sparkles icon or a demo shape.
          Stays put while the body below scrolls, so the masthead never
          disappears behind 35 lines of changes. Just the mark and the
          version; the headline and the cloud offer live in the body,
          in reading order, right where they always did. */}
      <div className="shrink-0 flex items-center gap-2.5 pl-5 pr-12 py-3.5 bg-lu-canvas border-b border-white/[0.06]">
        <img
          src={MONOGRAM}
          alt=""
          width={18}
          height={18}
          className={`${MONOGRAM_INVERT} shrink-0 opacity-90`}
        />
        <span className="text-[0.6rem] font-medium uppercase tracking-widest text-lu-accent">
          v{note.version}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Vor allem anderen und fetter als der Rest (David, 13.09.2026):
            wer aktualisiert, liest dieses Blatt einmal, und das Angebot
            gehoert an dessen Anfang statt zwischen die Fehlerbehebungen.
            Die drei Zeilen und der Satz kommen aus lib/cloud-pitch.ts,
            wortgleich mit dem Panel am Schalter. */}
        {note.cloud && (
          <div
            data-testid="release-cloud-block"
            className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 space-y-2"
          >
            <p className="text-[0.55rem] font-semibold uppercase tracking-widest text-lu-accent">
              Cloud
            </p>
            <ul className="space-y-1">
              {note.cloud.lines.map((line) => (
                <li key={line} className="text-[0.7rem] font-semibold leading-snug text-white">
                  {line}
                </li>
              ))}
            </ul>
            <p className="text-[0.62rem] leading-relaxed text-gray-300">{note.cloud.measured}</p>
            <p className="text-[0.62rem] leading-relaxed text-gray-300">{note.cloud.note}</p>
            <button
              onClick={onTurnOnCloud}
              className="w-full flex items-center justify-center h-8 rounded-lg bg-white text-black text-[0.7rem] font-semibold hover:bg-gray-200 transition-colors"
            >
              Turn on Cloud
            </button>
          </div>
        )}

        <div>
          <h3 className="text-[0.85rem] font-semibold text-white">What is new</h3>
          <p className="mt-1 text-[0.7rem] leading-relaxed text-gray-300">{note.headline}</p>
        </div>

        <ul className="space-y-2">
          {note.lines.map((line) => (
            <li key={line} className="flex gap-2 text-[0.68rem] leading-relaxed text-gray-300">
              <span className="mt-[0.4rem] w-1 h-1 rounded-full bg-lu-accent shrink-0" />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        {note.details && note.details.length > 0 && (
          <>
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-[0.62rem] text-lu-accent hover:text-lu-accent-hover transition-colors"
              aria-expanded={expanded}
            >
              <ChevronDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
              {expanded ? 'Hide details' : 'Show all changes'}
            </button>
            {expanded && (
              <div className="space-y-3">
                {note.details.map((section) => (
                  <div key={section.title} className="space-y-1.5">
                    <p className="text-[0.55rem] font-semibold uppercase tracking-widest text-gray-500">
                      {section.title}
                    </p>
                    <ul className="space-y-1">
                      {section.items.map((item) => (
                        <li key={item} className="flex gap-2 text-[0.6rem] leading-relaxed text-gray-500">
                          <span className="mt-[0.32rem] w-1 h-1 rounded-full bg-gray-600 shrink-0" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="shrink-0 flex items-center gap-2 px-5 py-4 border-t border-white/[0.06]">
        <button
          onClick={onClose}
          className="flex-1 flex items-center justify-center h-9 rounded-lg bg-white text-black text-[0.72rem] font-semibold hover:bg-gray-200 transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
  )
}
