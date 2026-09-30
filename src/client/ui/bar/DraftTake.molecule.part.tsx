import { DraftTake } from "./DraftTake"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { draftView, markRunningView, referencesView, withPromptView } from "../fixtures/views"
import type { ChromeView } from "../contract"

export const name = "Draft take"
export const note = "One marked take, or the real files, in the draft: its marks drawn on, what Send does with it, then each note."

function Take({ make, take }: { readonly make: () => ChromeView; readonly take: string }) {
  const { view, actions } = useFixture(make)
  const markup = view.markup._tag === "Ready" ? view.markup : null
  const group = markup?.groups.find(item => item.source.take === take)
  const frames = view.canvas._tag === "Frames" ? view.canvas.frames : []
  const names = markup?.groups.flatMap(item => item.marks.map(mark => mark.name)) ?? []
  return <PartScope width="15rem"><ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
    {group && <DraftTake group={group} frame={frames.find(frame => frame.marks.some(pin => group.marks.some(mark => mark.id === pin.id)))}
      device={{ name: view.device.name, width: view.device.cssWidth, height: view.device.cssHeight }} state="Default" names={names}
      editing={markup?.editor._tag === "Open" ? markup.editor.id : null} replacing={null} actions={actions} />}
  </ul></PartScope>
}
export default function TwoMarks() { return <Take make={draftView} take="6" /> }
export function LostMark() { return <Take make={draftView} take="3" /> }
export function OtherDevice() { return <Take make={draftView} take="2" /> }
export function Running() { return <Take make={markRunningView} take="5" /> }
/** Phase 6: every mark of take 3 is pointed to by 5A, so it is material for take 5's agent and makes no take. */
export function PointedTo() { return <Take make={referencesView} take="3" /> }
/** Phase 6: the real files, pointed to by 6B and 5A. */
export function RealFiles() { return <Take make={referencesView} take="0" /> }
/** Phase 6: marks on the real files that go with the typed prompt. */
export function WithPrompt() { return <Take make={withPromptView} take="0" /> }
/** Phase 6: 6B's note points to 0A; the name is set apart. */
export function Pointing() { return <Take make={referencesView} take="6" /> }
