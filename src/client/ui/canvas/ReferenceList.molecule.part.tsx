import { useState } from "react"
import { ReferenceList } from "./ReferenceList"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { typeaheadView } from "../fixtures/views"
import { insertReference, matchReferences, typedName } from "../references"

export const name = "Reference list"
export const note = "The note editor's type-ahead: the marks a note can point to that match what is typed, each with a crop, its name, where it is and its note."

function List({ query }: { readonly query: string }) {
  const { view, actions } = useFixture(typeaheadView)
  const [active, setActive] = useState(0)
  const editor = view.markup._tag === "Ready" && view.markup.editor._tag === "Open" ? view.markup.editor : null
  const options = editor ? matchReferences(editor.references, query) : []
  return <PartScope width="20rem">{editor && <ReferenceList id="dr-refs-part" options={options} active={active} onActive={setActive}
    onPick={option => {
      const typed = typedName(editor.note, editor.note.length)
      if (typed) actions.onMarkNote(editor.id, insertReference(editor.note, typed, option.name).text)
    }} />}</PartScope>
}
/** Typed "0": both marks on the real files. */
export default function RealFiles() { return <List query="0" /> }
/** Typed "3": a lost mark has no picture. */
export function NoPicture() { return <List query="3" /> }
/** No take number yet: every mark the note can point to, the most the list draws. */
export function Every() { return <List query="" /> }
