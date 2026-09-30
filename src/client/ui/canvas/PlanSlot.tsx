import type { Direction } from "../../../types"
import type { ChromeActions } from "../contract"
import { CAL } from "../hooks"
import { Icon } from "../atoms/Icon"
import "../tokens.css"
import "./canvas.css"

export type PlanSlotProps =
  | { readonly _tag: "Direction"; readonly id: string; readonly index: number; readonly direction: Direction; readonly actions: ChromeActions }
  | { readonly _tag: "Planning"; readonly index: number; readonly message: string }

/**
 * A direction waiting on the canvas in the place its take will fill
 * (decisions 16 and 33). It has a take's shape: a screen at the frame's size
 * and a caption under it. The screen is an unexposed plate that holds the
 * brief; the caption holds the title, as a take's caption holds its name.
 * Both are edited in place. The strange direction's plate has a dashed edge.
 * A slot being planned is a plate that is still developing.
 */
export function PlanSlot(props: PlanSlotProps) {
  if (props._tag === "Planning") {
    return <div className="dr-slot dr-slot--planning" role="group" aria-label={`Direction ${props.index + 1}, being planned`}>
      <div className="dr-slot__plate"><span className="dr-slot__planning">{props.message}</span><div className="dr-working" aria-hidden="true" /></div>
      <div className="dr-slot__caption"><span className="dr-slot__pending" aria-hidden="true" /></div>
    </div>
  }
  const { id, index, direction, actions } = props
  return <div className="dr-slot" data-strange={direction.strange || undefined} data-direction={id} role="group"
    aria-label={direction.strange ? `Direction ${index + 1}, the strange one` : `Direction ${index + 1}`}>
    <div className="dr-slot__plate">
      <textarea className="dr-slot__brief" data-cal={CAL.directionBrief} data-direction={id} aria-label={`Direction ${index + 1} brief`} value={direction.brief}
        onChange={event => actions.onDirection(id, "brief", event.currentTarget.value)} />
      {direction.strange && <p className="dr-slot__why">Strange: it breaks the current pattern on purpose.</p>}
    </div>
    <div className="dr-slot__caption">
      <input className="dr-slot__title" data-cal={CAL.directionTitle} data-direction={id} aria-label={`Direction ${index + 1} title`} value={direction.title}
        onChange={event => actions.onDirection(id, "title", event.currentTarget.value)} />
      <button type="button" className="dr-slot__remove" data-cal={CAL.directionRemove} data-direction={id} aria-label={`Remove direction ${index + 1}: ${direction.title}`}
        title="Remove this direction" onClick={() => actions.onRemoveDirection(id)}><Icon name="close" /></button>
    </div>
  </div>
}
