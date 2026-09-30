import { DraftMark } from "./DraftMark"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { draftView, referencesView, replacingView, sendingView, typeaheadView } from "../fixtures/views"
import type { ChromeView } from "../contract"

export const name = "Draft mark"
export const note = "One mark in the draft: its pin, its note, and Remove. A lost mark says so, with Re-place."

function One({ make, id, where = null }: { readonly make: () => ChromeView; readonly id: string; readonly where?: string | null }) {
  const { view, actions } = useFixture(make)
  const markup = view.markup._tag === "Ready" ? view.markup : null
  const group = markup?.groups.find(item => item.marks.some(mark => mark.id === id))
  const mark = group?.marks.find(item => item.id === id)
  return <PartScope width="15rem"><ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
    {group && mark && <DraftMark mark={mark} where={where} take={group.source.take} actions={actions}
      references={markup?.editor._tag === "Open" ? markup.editor.references : []}
      editing={markup?.editor._tag === "Open" && markup.editor.id === id} replacing={markup?.mode._tag === "Replacing" && markup.mode.id === id} />}
  </ul></PartScope>
}
export default function Noted() { return <One make={draftView} id="m-6b" /> }
export function Lost() { return <One make={draftView} id="m-3a" /> }
export function Replacing() { return <One make={replacingView} id="m-3a" /> }
export function OtherDevice() { return <One make={draftView} id="m-2a" where="Placed on Default, ODIN 2 PORTAL" /> }
export function Sending() { return <One make={sendingView} id="m-5a" /> }
/** Phase 6: 5A points to 0A and 3A; the names are set apart, the note is not rewritten. */
export function Pointing() { return <One make={referencesView} id="m-5a" /> }
/** Phase 6: a mark on the real files is named 0A. */
export function RealFiles() { return <One make={referencesView} id="m-0a" /> }
/** Phase 6: its note open in the draft, with the marks it can point to. */
export function Editing() { return <One make={typeaheadView} id="m-6b" /> }
