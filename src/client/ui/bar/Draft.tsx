import type { ChromeActions, ChromeView, MarkupView } from "../contract"
import { CAL } from "../hooks"
import { DraftTake } from "./DraftTake"
import "../tokens.css"
import "./draft.css"

export type DraftProps = {
  readonly markup: Extract<MarkupView, { _tag: "Ready" }>
  readonly view: ChromeView
  readonly actions: ChromeActions
}

/**
 * The draft, unfolded above the bar (decision 35): the marked takes in a
 * row, the same shape as the canvas, each with its marks drawn on and each
 * note under its mark. On a narrow bar the takes stack. The draft scrolls
 * inside itself, so it never takes more than its share of the stage.
 */
export function Draft({ markup, view, actions }: DraftProps) {
  const frames = view.canvas._tag === "Frames" ? view.canvas.frames : []
  const marks = markup.groups.reduce((sum, group) => sum + group.marks.length, 0)
  const editing = markup.editor._tag === "Open" ? markup.editor.id : null
  const replacing = markup.mode._tag === "Replacing" ? markup.mode.id : null
  const device = { name: view.device.name, width: view.device.cssWidth, height: view.device.cssHeight }
  const state = view.selection._tag === "State" ? view.selection.label : ""
  return <section className="dr-draft" data-cal={CAL.draft} aria-label="Draft marks">
    <header className="dr-draft__head">
      <b>{marks} {marks === 1 ? "mark" : "marks"}</b>
      <span>on {markup.groups.length} {markup.groups.length === 1 ? "take" : "takes"}</span>
    </header>
    <ul className="dr-draft__takes">
      {markup.groups.map(group => <DraftTake key={`${group.source.take}@${group.source.created}`} group={group}
        frame={frames.find(frame => frame.marks.some(pin => group.marks.some(mark => mark.id === pin.id)))}
        device={device} state={state} editing={editing} replacing={replacing} actions={actions} />)}
    </ul>
  </section>
}
