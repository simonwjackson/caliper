import { Caption } from "./Caption"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { odinView, takesView } from "../fixtures/views"

export const name = "Frame caption"
export const note = "The devices as the switch, the width, and whether the frames are true size."

export default function TrueSize() {
  const { view, actions } = useFixture(takesView)
  return <PartScope width="30rem"><Caption view={view} actions={actions} geometry={{ width: 279, height: 209, scale: 0.44, fit: { _tag: "TrueSize" } }} /></PartScope>
}
export function Scaled() {
  const { view, actions } = useFixture(odinView)
  return <PartScope width="30rem"><Caption view={view} actions={actions} geometry={{ width: 400, height: 225, scale: 0.21, fit: { _tag: "Scaled", percent: 66 } }} /></PartScope>
}
export function Uncalibrated() {
  const { view, actions } = useFixture(() => ({ ...takesView(), calibrated: false }))
  return <PartScope width="30rem"><Caption view={view} actions={actions} geometry={{ width: 272, height: 204, scale: 0.43, fit: { _tag: "TrueSize" } }} /></PartScope>
}
