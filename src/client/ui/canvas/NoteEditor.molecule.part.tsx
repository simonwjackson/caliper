import { NoteEditor } from "./NoteEditor"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { markView, sendingView, typeaheadView } from "../fixtures/views"
import type { ChromeView } from "../contract"

export const name = "Note editor"
export const note = "A card with the mark's name on a filled tag and one line. Each change is sent as you type; typing a take number offers marks to point to; Enter closes it."

function Editor({ make, id }: { readonly make: () => ChromeView; readonly id?: string }) {
  const { view, actions } = useFixture(make)
  const markup = view.markup._tag === "Ready" ? view.markup : null
  const open = markup?.editor._tag === "Open" ? markup.editor : null
  const mark = !open && id ? markup?.groups.flatMap(group => group.marks).find(item => item.id === id) : null
  const shown = open ?? (mark ? { id: mark.id, name: mark.name, note: mark.note, edit: mark.edit, references: [] } : null)
  const referencesOf = markup ? new Map(markup.groups.flatMap(group => group.marks.map(item => [item.id, item.references] as const))) : undefined
  return <PartScope width="24rem">{shown
    ? <NoteEditor id={shown.id} name={shown.name} note={shown.note} edit={shown.edit} references={shown.references} referencesOf={referencesOf}
      onNote={actions.onMarkNote} onClose={() => actions.onMarkEdit(null)} />
    : <p style={{ color: "var(--dr-ink-3)", fontSize: 12 }}>The note is closed.</p>}</PartScope>
}
export default function Open() { return <Editor make={markView} /> }
export function WhileSending() { return <Editor make={sendingView} id="m-6b" /> }
/** Phase 6: the note ends in "like 0", so the list offers the marks on the real files while the field has focus. */
export function TypeAhead() { return <Editor make={typeaheadView} /> }
