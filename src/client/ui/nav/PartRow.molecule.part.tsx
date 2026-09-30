import { PartRow } from "./PartRow"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { takesView } from "../fixtures/views"

export const name = "Part row"
export const note = "One part: a row that folds its states open."

export default function Open() {
  const { view, actions } = useFixture(takesView)
  const part = view.navigation.parts[0]
  return <PartScope width="16.5rem"><ul className="dr-layer__parts">{part && <PartRow part={part} actions={actions} picked={() => undefined} />}</ul></PartScope>
}
export function Folded() {
  const { view, actions } = useFixture(takesView)
  const part = view.navigation.parts[1]
  return <PartScope width="16.5rem"><ul className="dr-layer__parts">{part && <PartRow part={part} actions={actions} picked={() => undefined} />}</ul></PartScope>
}
