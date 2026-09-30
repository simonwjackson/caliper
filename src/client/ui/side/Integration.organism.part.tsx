import { Integration } from "./Integration"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { alternateView } from "../fixtures/views"

export const name = "Alternate review"
export const note = "Every control binds to the exact revision under review. Apply waits for checks and your attestation."

export default function Review() {
  const { view, actions } = useFixture(alternateView)
  return <PartScope width="19rem">{view.record._tag === "Open" && <Integration take={view.record.take.id} view={view.record.integration} actions={actions} />}</PartScope>
}
export function Preparing() {
  const { actions } = useFixture(alternateView)
  return <PartScope width="19rem"><Integration take="7" view={{ _tag: "Preparing", sourceTake: "6", message: "The alternate's agent is proposing how to integrate take 6." }} actions={actions} /></PartScope>
}
export function Unloaded() {
  const { actions } = useFixture(alternateView)
  return <PartScope width="19rem"><Integration take="7" view={{ _tag: "Unloaded", sourceTake: "6", load: { _tag: "Enabled" }, notices: [{ kind: "warning", text: "The source changed since the proposal. Review it again." }] }} actions={actions} /></PartScope>
}
