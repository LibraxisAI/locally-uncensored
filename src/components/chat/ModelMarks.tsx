import { useModelStore } from '../../stores/modelStore'
import { ModelRowMarks } from '../models/ModelRowMarks'

/**
 * Die Marken des Modells, das gerade in der Eingabezeile steht.
 *
 * Dieselben zwei Marken wie in der Modellauswahl, aus demselben Bauteil, damit
 * Auswahl und Eingabezeile nie zwei Wahrheiten zeigen. Was eine Anfrage
 * enthalten darf, entscheidet der Server bei jedem Aufruf neu.
 */
export function ModelMarks() {
  const active = useModelStore((s) => s.models.find((m) => m.name === s.activeModel))
  if (!active) return null
  const unfiltered = 'unfiltered' in active ? active.unfiltered : undefined
  const flash = 'flash' in active ? active.flash : undefined
  if (unfiltered !== 'full' && !flash) return null

  return (
    <div className="mb-1 flex flex-wrap items-center gap-2" data-testid="model-marks">
      <ModelRowMarks model={{ unfiltered, flash }} />
    </div>
  )
}
