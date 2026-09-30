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
 * A direction waiting on the canvas in the slot its take will fill
 * (decisions 16 and 33). The title and brief are edited in place. The strange
 * direction has a dashed edge and says why. A slot being planned shows only
 * that it is being planned.
 */
export function PlanSlot(props: PlanSlotProps) {
  if (props._tag === "Planning") {
    return <div className="dr-slot dr-slot--planning" aria-label={`Direction ${props.index + 1}, being planned`}>
      <span className="dr-slot__planning">{props.message}</span>
      <div className="dr-working" aria-hidden="true" />
    </div>
  }
  const { id, index, direction, actions } = props
  return <fieldset className={`dr-slot${direction.strange ? " dr-slot--strange" : ""}`} data-direction={id}>
    <legend className="dr-sr">{direction.strange ? `Direction ${index + 1}, the strange one` : `Direction ${index + 1}`}</legend>
    <input className="dr-slot__title" data-cal={CAL.directionTitle} data-direction={id} aria-label={`Direction ${index + 1} title`} value={direction.title}
      onChange={event => actions.onDirection(id, "title", event.currentTarget.value)} />
    <textarea className="dr-slot__brief" data-cal={CAL.directionBrief} data-direction={id} aria-label={`Direction ${index + 1} brief`} value={direction.brief}
      onChange={event => actions.onDirection(id, "brief", event.currentTarget.value)} />
    {direction.strange && <p className="dr-slot__why">Strange direction: it breaks this part's current pattern on purpose.</p>}
    <button type="button" className="dr-slot__remove" data-cal={CAL.directionRemove} data-direction={id} aria-label={`Remove direction ${index + 1}: ${direction.title}`}
      title="Remove this direction" onClick={() => actions.onRemoveDirection(id)}><Icon name="close" /></button>
  </fieldset>
}
