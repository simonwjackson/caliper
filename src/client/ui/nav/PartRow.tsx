import type { ChromeActions, NavPart } from "../contract"
import { CAL } from "../hooks"
import { NavStates } from "./NavStates"
import { Icon } from "../atoms/Icon"
import "../tokens.css"
import "./nav.css"

/**
 * One part. The caret folds its states open, independently of the selection.
 * The name selects every state of the part, folded or not.
 */
export function PartRow({ part, actions, picked }: { readonly part: NavPart; readonly actions: ChromeActions; readonly picked: () => void }) {
  const statesId = `dr-states-${part.file.replace(/[^a-z0-9]/gi, "-")}`
  return <li className="dr-part" data-part={part.file} data-open={part.expanded || undefined}>
    <div className="dr-part__row">
      <button type="button" className="dr-part__caret" data-cal={CAL.partExpand} data-part={part.file} aria-expanded={part.expanded} aria-controls={statesId}
        aria-label={`${part.expanded ? "Collapse" : "Expand"} ${part.name} states`} onClick={() => actions.onPartExpanded(part.file, !part.expanded)}>
        <span aria-hidden="true">{part.expanded ? "▾" : "▸"}</span>
      </button>
      <button type="button" className="dr-part__name" data-cal={CAL.part} data-part={part.file} aria-current={part.selected || undefined}
        title={[part.file, part.note, part.layerSite].filter(Boolean).join("\n")} onClick={() => { actions.onPart(part.file); picked() }}>
        <span className="dr-part__label">{part.name}</span>
        {part.pinned > 0 && <span className="ws-pinned" title={`${part.pinned} pinned to the board`}><Icon name="pin" />{part.pinned}<span className="dr-sr"> pinned</span></span>}
        <span className="dr-part__count" aria-label={`, ${part.states.length} ${part.states.length === 1 ? "state" : "states"}`}>{part.states.length}</span>
      </button>
    </div>
    {part.expanded && <NavStates id={statesId} part={part} actions={actions} picked={picked} />}
  </li>
}
