import { TokenPicker } from "./TokenPicker"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { knobsView } from "../fixtures/views"

export const name = "Token picker"
export const note = "A token knob's field: the chosen token and its swatch; its siblings open as a list that scrolls and filters."

function One({ id }: { readonly id: string }) {
  const { view, actions } = useFixture(knobsView)
  const knob = view.knobs._tag === "Ready" ? view.knobs.knobs.find(item => item.id === id) : undefined
  return <PartScope width="19rem">{knob?.control._tag === "Token" && <TokenPicker knob={knob} control={knob.control} actions={actions} disabled={false} />}</PartScope>
}
export default function Colour() { return <One id="bg" /> }
export function Saved() { return <One id="accent" /> }
