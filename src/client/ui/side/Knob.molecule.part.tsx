import { Knob } from "./Knob"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { knobsView } from "../fixtures/views"

export const name = "Knob"
export const note = "One declaration: a slider with a range, a scrub without one, a palette for a token, a select for a choice."

function One({ id }: { readonly id: string }) {
  const { view, actions } = useFixture(knobsView)
  const knob = view.knobs._tag === "Ready" ? view.knobs.knobs.find(item => item.id === id) : undefined
  return <PartScope width="19rem"><ul className="dr-kgroup__list">{knob && <Knob knob={knob} actions={actions} />}</ul></PartScope>
}
export default function Bounded() { return <One id="rows" /> }
export function Unbounded() { return <One id="u" /> }
export function Palette() { return <One id="bg" /> }
export function Colour() { return <One id="plate" /> }
export function Choice() { return <One id="shape" /> }
export function Conflict() { return <One id="launch" /> }
