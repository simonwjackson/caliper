import { PartsPanel } from "./PartsPanel"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { noneView, setupProblemsView, takesView } from "../fixtures/views"

export const name = "Parts panel"
export const note = "Filter, preview scenario, parts by layer, their states and takes, and setup."

export default function Docked() {
  const { view, actions } = useFixture(takesView)
  return <PartScope width="16.5rem" height="60rem"><PartsPanel view={view} actions={actions} drawer={false} /></PartScope>
}
export function Composed() {
  const { view, actions } = useFixture(setupProblemsView)
  return <PartScope width="16.5rem" height="60rem"><PartsPanel view={view} actions={actions} drawer={false} /></PartScope>
}
export function NothingSelected() {
  const { view, actions } = useFixture(noneView)
  return <PartScope width="16.5rem" height="40rem"><PartsPanel view={view} actions={actions} drawer={false} /></PartScope>
}
