import { Calibration } from "./Calibration"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { calibrateView } from "../fixtures/views"

export const name = "Calibrate"
export const note = "The credit-card outline at the current px per mm, and the slider that matches it to a real card."

export default function Open() {
  const { view, actions } = useFixture(calibrateView)
  return <PartScope width="40rem" height="32rem"><Calibration view={view} actions={actions} /></PartScope>
}
