import { DraftTake } from "./DraftTake"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { draftView, markRunningView } from "../fixtures/views"
import type { ChromeView } from "../contract"

export const name = "Draft take"
export const note = "One marked take in the draft: the take with its marks drawn on, what Send does for it, then each note."

function Take({ make, take }: { readonly make: () => ChromeView; readonly take: string }) {
  const { view, actions } = useFixture(make)
  const markup = view.markup._tag === "Ready" ? view.markup : null
  const group = markup?.groups.find(item => item.source.take === take)
  const frames = view.canvas._tag === "Frames" ? view.canvas.frames : []
  return <PartScope width="15rem"><ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
    {group && <DraftTake group={group} frame={frames.find(frame => frame.marks.some(pin => group.marks.some(mark => mark.id === pin.id)))}
      device={{ name: view.device.name, width: view.device.cssWidth, height: view.device.cssHeight }} state="Default"
      editing={markup?.editor._tag === "Open" ? markup.editor.id : null} replacing={null} actions={actions} />}
  </ul></PartScope>
}
export default function TwoMarks() { return <Take make={draftView} take="6" /> }
export function LostMark() { return <Take make={draftView} take="3" /> }
export function OtherDevice() { return <Take make={draftView} take="2" /> }
export function Running() { return <Take make={markRunningView} take="5" /> }
