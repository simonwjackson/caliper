import type { ChromeActions, NavPart } from "../contract"
import { CAL } from "../hooks"
import { NavStates } from "./NavStates"
import "../tokens.css"
import "./nav.css"

/** One part: a row that folds its states open, independently of the selection. */
export function PartRow({ part, actions, picked }: { readonly part: NavPart; readonly actions: ChromeActions; readonly picked: () => void }) {
  const statesId = `dr-states-${part.file.replace(/[^a-z0-9]/gi, "-")}`
  return <li className="dr-part" data-part={part.file} data-open={part.expanded || undefined}>
    <button type="button" className="dr-part__row" data-cal={CAL.partExpand} data-part={part.file} aria-expanded={part.expanded} aria-controls={statesId}
      title={[part.file, part.note, part.layerSite].filter(Boolean).join("\n")} onClick={() => actions.onPartExpanded(part.file, !part.expanded)}>
      <span className="dr-part__caret" aria-hidden="true">{part.expanded ? "▾" : "▸"}</span>
      <span className="dr-part__name">{part.name}</span>
      <span className="dr-part__count">{part.states.length}</span>
    </button>
    {part.expanded && <NavStates id={statesId} part={part} actions={actions} picked={picked} />}
  </li>
}
