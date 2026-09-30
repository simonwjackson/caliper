import { useEffect, useRef } from "react"
import type { PartLayer } from "../../../types"
import type { ChromeActions, ChromeView } from "../contract"
import { CAL } from "../hooks"
import { Panel } from "../atoms/Panel"
import { PartRow } from "./PartRow"
import { SetupFooter } from "./SetupFooter"
import "../tokens.css"
import "./nav.css"

const LAYERS: readonly (PartLayer | undefined)[] = ["page", "template", "organism", "molecule", "atom", undefined]
const LAYER_NAMES: Record<PartLayer | "none", string> = { page: "Pages", template: "Templates", organism: "Organisms", molecule: "Molecules", atom: "Atoms", none: "Unclassified" }

export type PartsPanelProps = {
  readonly view: ChromeView; readonly actions: ChromeActions
  /** A drawer over the room, not a docked column. */
  readonly drawer: boolean
  /** Closes the drawer. A pick in the drawer closes it too, so the frame is in view. */
  readonly onClose?: () => void
}

/** The parts panel: filter, preview scenario, the parts by layer, their states and takes, and setup. */
export function PartsPanel({ view, actions, drawer, onClose }: PartsPanelProps) {
  const nav = view.navigation
  const picked = () => onClose?.()
  const scenario = nav.scenario
  const box = useRef<HTMLDivElement>(null)
  // A drawer takes focus when it opens, on its close button, so Escape and Tab start there.
  useEffect(() => { if (drawer) box.current?.querySelector<HTMLElement>(".dr-panel__close")?.focus() }, [drawer])
  return <div ref={box} className="dr-parts" data-place={drawer ? "drawer" : "docked"} role={drawer ? "dialog" : undefined} aria-modal={drawer ? true : undefined} aria-label={drawer ? "Parts" : undefined}>
    <Panel hook={CAL.nav} label="Parts" title={nav.project} sub={nav.countLabel} onClose={onClose} closeLabel="Close parts">
      <div className="dr-parts__body">
        <input className="dr-parts__filter" data-cal={CAL.filter} type="search" placeholder="Filter parts" aria-label="Filter parts" value={nav.filter}
          onChange={event => actions.onFilter(event.currentTarget.value)} />
        {scenario._tag === "Selected" && <section className="dr-parts__scenario" aria-label="Scenario context">
          <label className="dr-parts__preview">Preview
            <select data-cal={CAL.context} value={scenario.chosen} onChange={event => actions.onContext(event.currentTarget.value)}>
              {scenario.choices.map(choice => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
            </select>
          </label>
          {(scenario.note || scenario.whole || scenario.children.length > 0) && <div className="dr-parts__context">
            <p className="dr-parts__editing">{scenario.editingLabel}</p>
            {scenario.note && <p className="dr-parts__note" role="status">{scenario.note}</p>}
            {scenario.whole && <button type="button" className="dr-parts__link" data-cal={CAL.whole} onClick={() => { actions.onWholeScenario(); picked() }}>Edit the whole scenario: {scenario.whole.label}</button>}
            {scenario.children.length > 0 && <div className="dr-parts__children" role="group" aria-label="Parts in this scenario">
              {scenario.children.map(child => <button key={`${child.ref.part}#${child.ref.state}`} type="button" className="dr-parts__child" data-cal={CAL.subject}
                data-part={child.ref.part} data-state={child.ref.state} aria-current={child.selected || undefined} onClick={() => { actions.onSubject(child.ref); picked() }}>{child.label}</button>)}
            </div>}
          </div>}
        </section>}
        <div className="dr-parts__tree">
          {nav.parts.length === 0 && <p className="dr-parts__empty">{nav.emptyMessage || "No parts match."}</p>}
          {LAYERS.map(layer => {
            const parts = nav.parts.filter(part => part.layer === layer)
            if (parts.length === 0) return null
            return <section key={layer ?? "none"} className="dr-layer" aria-label={LAYER_NAMES[layer ?? "none"]}>
              <h3 className="dr-layer__name">{LAYER_NAMES[layer ?? "none"]}</h3>
              <ul className="dr-layer__parts">{parts.map(part => <PartRow key={part.file} part={part} actions={actions} picked={picked} />)}</ul>
            </section>
          })}
          {nav.unavailable.length > 0 && <section className="dr-layer dr-unavailable" data-cal={CAL.unavailable} aria-label="Unavailable states">
            <h3 className="dr-layer__name">Unavailable states</h3>
            {nav.unavailable.map(group => <div key={`${group.subject.part}#${group.subject.state}`} className="dr-unavailable__group">
              <p className="dr-unavailable__label">{group.label}</p>
              {group.takes.map(take => <button key={take.id} type="button" className="dr-states__take" data-cal={CAL.navTake} data-take={take.id} aria-current={take.selected || undefined}
                onClick={() => { actions.onTake(take.id); picked() }}>{take.label}</button>)}
            </div>)}
          </section>}
        </div>
        <SetupFooter rows={nav.setup} problems={nav.setupProblems} />
      </div>
    </Panel>
  </div>
}

