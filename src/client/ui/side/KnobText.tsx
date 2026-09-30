import type { ChromeActions, KnobView } from "../contract"
import { CAL } from "../hooks"
import "../tokens.css"
import "./side.css"

/** A colour's text, for a value the colour input cannot hold, such as a colour function. */
export function KnobText({ knob, actions, disabled }: { readonly knob: KnobView; readonly actions: ChromeActions; readonly disabled: boolean }) {
  return <input type="text" className="dr-knob__text" data-cal={CAL.knobValue} data-knob={knob.id} aria-label={knob.label} disabled={disabled} value={knob.value}
    spellCheck={false} onChange={event => actions.onKnobInput(knob.id, event.currentTarget.value)} onBlur={event => actions.onKnobCommit(knob.id, event.currentTarget.value)}
    onKeyDown={event => { if (event.key === "Enter") actions.onKnobCommit(knob.id, event.currentTarget.value); else if (event.key === "Escape") actions.onKnobCancel(knob.id) }} />
}
