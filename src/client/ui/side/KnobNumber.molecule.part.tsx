import { KnobNumber } from "./KnobNumber"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { knobsView } from "../fixtures/views"

export const name = "Number knob"
export const note = "A scrub handle, a slider only when the source gives a range, and the typed value."

function One({ id }: { readonly id: string }) {
  const { view, actions } = useFixture(knobsView)
  const knob = view.knobs._tag === "Ready" ? view.knobs.knobs.find(item => item.id === id) : undefined
  return <PartScope width="19rem"><div className="dr-knob">{knob?.control._tag === "Number" && <KnobNumber knob={knob} control={knob.control} actions={actions} disabled={false} onLive={() => undefined} />}</div></PartScope>
}
export default function WithRange() { return <One id="min" /> }
export function Threshold() { return <One id="stage" /> }
