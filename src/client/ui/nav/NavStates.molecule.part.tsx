import { NavStates } from "./NavStates"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { errorView, takesView } from "../fixtures/views"

export const name = "Part states"
export const note = "Every state at once, each state with its check dot, and each state's takes."

export default function WithTakes() {
  const { view, actions } = useFixture(takesView)
  const part = view.navigation.parts[0]
  return <PartScope width="16.5rem">{part && <NavStates id="states" part={part} actions={actions} picked={() => undefined} />}</PartScope>
}
export function FailingState() {
  const { view, actions } = useFixture(errorView)
  const part = view.navigation.parts[0]
  return <PartScope width="16.5rem">{part && <NavStates id="states" part={part} actions={actions} picked={() => undefined} />}</PartScope>
}
