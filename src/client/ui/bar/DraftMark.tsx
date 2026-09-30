import type { ChromeActions, DraftMarkView, ReferenceOption } from "../contract"
import { CAL } from "../hooks"
import { Icon } from "../atoms/Icon"
import { MarkPin } from "../canvas/MarkPin"
import { NoteEditor } from "../canvas/NoteEditor"
import { NoteText } from "../atoms/NoteText"
import "../tokens.css"
import "../atoms/atoms.css"
import "./draft.css"

export type DraftMarkProps = {
  readonly mark: DraftMarkView
  /** The state and device the mark was placed on, when they are not the ones on the canvas. */
  readonly where: string | null
  /** The note editor is open at this mark. */
  readonly editing: boolean
  /** The next click or drag on its take moves this mark. */
  readonly replacing: boolean
  readonly take: string
  readonly actions: Pick<ChromeActions, "onMarkEdit" | "onMarkNote" | "onMarkRemove" | "onMarkReplace" | "onMarkMode">
  /** While its note is open: the marks it can point to, and the names their own notes point to. */
  readonly references?: readonly ReferenceOption[]
  readonly referencesOf?: ReadonlyMap<string, readonly string[]>
}

function refocus(id: string) {
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-cal="${CAL.markEdit}"][data-mark-id="${CSS.escape(id)}"]`)?.focus())
}

/**
 * One mark in the draft: its pin, its note, and Remove. Press the note to
 * edit it in place. The names the note points to are set apart. A mark whose
 * element is gone says so in the warn colour, with Re-place; Send waits
 * until it is found, moved or removed.
 */
export function DraftMark({ mark, where, editing, replacing, take, actions, references = [], referencesOf }: DraftMarkProps) {
  const lost = mark.location._tag !== "Located"
  const on = take === "0" ? "the real files" : `take ${take}`
  return <li className="dr-dmark" data-mark-id={mark.id} data-location={mark.location._tag}>
    <MarkPin letter={mark.letter} kind={mark.kind} location={mark.location._tag} size="inline" />
    <div className="dr-dmark__body">
      {editing
        ? <NoteEditor id={mark.id} name={mark.name} note={mark.note} edit={mark.edit} onNote={actions.onMarkNote} references={references} referencesOf={referencesOf}
          onClose={() => { actions.onMarkEdit(null); refocus(mark.id) }} />
        : <button type="button" className="dr-dmark__note" data-cal={CAL.markEdit} data-mark-id={mark.id} disabled={mark.edit._tag === "Disabled"}
          title={mark.edit._tag === "Disabled" ? mark.edit.reason : `Edit the note for ${mark.name}`} onClick={() => actions.onMarkEdit(mark.id)}>
          {mark.note ? <NoteText text={mark.note} names={mark.references} /> : <span className="dr-dmark__empty">No note yet</span>}
        </button>}
      {where && <span className="dr-dmark__where">{where}</span>}
      {replacing
        ? <span className="dr-dmark__lost" role="status">Click or drag on {on} to place {mark.name}. <button type="button" className="dr-dmark__link" onClick={() => actions.onMarkMode(false)}>Cancel</button></span>
        : lost && <span className="dr-dmark__lost">{mark.location._tag === "Lost" || mark.location._tag === "Unresolved" ? mark.location.reason : ""}{" "}
          <button type="button" className="dr-dmark__link" data-cal={CAL.markReplace} data-mark-id={mark.id} disabled={mark.replace._tag === "Disabled"}
            title={mark.replace._tag === "Disabled" ? mark.replace.reason : undefined} onClick={() => actions.onMarkReplace(mark.id)}>Re-place</button></span>}
    </div>
    <button type="button" className="dr-dmark__remove" data-cal={CAL.markRemove} data-mark-id={mark.id} disabled={mark.remove._tag === "Disabled"}
      aria-label={`Remove ${mark.name}`} title={mark.remove._tag === "Disabled" ? mark.remove.reason : `Remove ${mark.name}`} onClick={() => actions.onMarkRemove(mark.id)}><Icon name="close" /></button>
  </li>
}
