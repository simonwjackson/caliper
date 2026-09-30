import type { ChromeActions, ChromeView, KnobView } from "../contract"
import { CAL } from "../hooks"
import { Notices } from "../atoms/Notices"
import { Panel } from "../atoms/Panel"
import { Knob } from "./Knob"
import { Literal } from "./Literal"
import "../tokens.css"
import "./side.css"

const GROUPS: readonly { readonly origin: KnobView["origin"]; readonly name: string }[] = [
  { origin: "Property", name: "Registered" }, { origin: "Threshold", name: "Thresholds" }, { origin: "Plain", name: "This part reads" },
]

/**
 * Knobs in the side panel: registered properties, container thresholds and
 * the plain properties the part reads, then literals that could be tokens.
 * What is not a knob folds into one line with the reason for each.
 */
export function KnobsPanel({ view, actions, sheet }: { readonly view: ChromeView; readonly actions: ChromeActions; readonly sheet: boolean }) {
  const knobs = view.knobs
  if (knobs._tag === "Closed") return null
  const target = knobs._tag === "Ready" || knobs._tag === "Finding" ? knobs.target : undefined
  return <Panel hook={CAL.knobs} label="Knobs" className="dr-knobs" title="Knobs" sub={target} onClose={() => actions.onTool("preview")} closeLabel="Close Knobs">
    <div className="dr-knobs__body" data-sheet={sheet || undefined}>
      {knobs._tag === "Idle" && <p className="dr-side__quiet">{knobs.message}</p>}
      {knobs._tag === "Finding" && <><p className="dr-side__quiet" role="status">Finding the knobs of {knobs.target}…</p><div className="dr-working" aria-hidden="true" /></>}
      {knobs._tag === "Ready" && <>
        <Notices notices={knobs.problems.map(text => ({ kind: "warning", text }))} />
        {knobs.knobs.length === 0 && <p className="dr-side__quiet">No design input of this part is a knob yet. A doc comment above a declaration can make one.</p>}
        {GROUPS.map(group => {
          const list = knobs.knobs.filter(knob => knob.origin === group.origin)
          if (list.length === 0) return null
          return <section key={group.origin} className="dr-kgroup" aria-label={group.name}>
            <h3 className="dr-kgroup__name"><span>{group.name}</span><span className="dr-kgroup__count">{list.length}</span></h3>
            <ul className="dr-kgroup__list">{list.map(knob => <Knob key={knob.id} knob={knob} actions={actions} />)}</ul>
          </section>
        })}
        {knobs.skipped.length > 0 && <details className="dr-skipped">
          <summary>{knobs.skipped.length} not {knobs.skipped.length === 1 ? "a knob" : "knobs"}<i className="dr-chev" aria-hidden="true" /></summary>
          <ul>{knobs.skipped.map(item => <li key={`${item.name}@${item.where}`}><code>{item.name}</code> {item.reason} <span className="dr-skipped__where">{item.where}</span></li>)}</ul>
        </details>}
        <details className="dr-kgroup dr-literals" data-cal={CAL.literals} open={knobs.literals._tag !== "Closed"}
          onToggle={event => { const open = event.currentTarget.open; if (open !== (knobs.literals._tag !== "Closed")) actions.onLiteralsOpen(open) }}>
          <summary className="dr-kgroup__name"><span>Literals</span>
            <span className="dr-kgroup__count">{knobs.literals._tag === "Ready" ? knobs.literals.literals.length : ""}</span><i className="dr-chev" aria-hidden="true" /></summary>
          {knobs.literals._tag === "Finding" && <p className="dr-side__quiet" role="status">Finding literals…</p>}
          {knobs.literals._tag === "Failed" && <p className="dr-side__bad" role="alert">{knobs.literals.reason}</p>}
          {knobs.literals._tag === "Ready" && <>
            {/* One live region for the ready list, present even when it has nothing to say. */}
            <p className="dr-side__quiet dr-literals__status" role="status">{knobs.literals.notice ?? ""}</p>
            {knobs.literals.literals.length === 0 && <p className="dr-side__quiet">No literal here could be a token.</p>}
            <ul className="dr-kgroup__list">{knobs.literals.literals.map(literal => <Literal key={literal.id} literal={literal} actions={actions} />)}</ul>
            {knobs.literals.refused.length > 0 && <details className="dr-skipped">
              <summary>{knobs.literals.refused.length} could not be placed<i className="dr-chev" aria-hidden="true" /></summary>
              <ul>{knobs.literals.refused.map(item => <li key={`${item.name}@${item.where}`}><code>{item.name}</code> {item.reason} <span className="dr-skipped__where">{item.where}</span></li>)}</ul>
            </details>}
          </>}
        </details>
      </>}
    </div>
  </Panel>
}
