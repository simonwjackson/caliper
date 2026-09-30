import "../tokens.css"
import "../atoms/atoms.css"
import "./canvas.css"

export type PlanSlotProps = { readonly index: number }

/**
 * A take being planned, in the place its take will fill (decision 16). It has
 * a take's shape: a screen at the frame's size and a caption under it. The
 * screen is a plate that is still developing and shows no words; the bar
 * holds the one status line. Only a screen reader hears the slot's name. The take replaces the slot as soon as it starts.
 */
export function PlanSlot({ index }: PlanSlotProps) {
  return <div className="dr-slot dr-slot--planning" role="group">
    <span className="dr-sr">Take {index + 1}, being planned</span>
    <div className="dr-slot__plate"><div className="dr-working" aria-hidden="true" /></div>
    <div className="dr-slot__caption"><span className="dr-slot__pending" aria-hidden="true" /></div>
  </div>
}
