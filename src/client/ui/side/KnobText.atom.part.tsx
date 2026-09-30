import { KnobText } from "./KnobText"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { knobsView } from "../fixtures/views"

export const name = "Colour text"
export const note = "A colour's text, for values the colour input cannot hold."

export default function Hex() {
  const { view, actions } = useFixture(knobsView)
  const knob = view.knobs._tag === "Ready" ? view.knobs.knobs.find(item => item.id === "plate") : undefined
  return <PartScope width="12rem">{knob && <KnobText knob={knob} actions={actions} disabled={false} />}</PartScope>
}
