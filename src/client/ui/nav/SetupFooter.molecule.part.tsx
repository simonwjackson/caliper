import { SetupFooter } from "./SetupFooter"
import { PartScope } from "../fixtures/PartScope"
import { setupProblemsView, takesView } from "../fixtures/views"

export const name = "Setup footer"
export const note = "One line; it unfolds to each derived value, where it came from and its problems."

export default function Found() {
  const nav = takesView().navigation
  return <PartScope width="16.5rem"><SetupFooter rows={nav.setup} problems={nav.setupProblems} /></PartScope>
}
export function Problems() {
  const nav = setupProblemsView().navigation
  return <PartScope width="16.5rem"><SetupFooter rows={nav.setup} problems={nav.setupProblems} /></PartScope>
}
