import { KnobsPanel } from "./KnobsPanel"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { knobsFindingView, knobsView } from "../fixtures/views"
import type { ChromeView } from "../contract"

export const name = "Knobs panel"
export const note = "Registered properties, thresholds, what the part reads, then literals that could be tokens."

function Knobs({ make }: { readonly make: () => ChromeView }) {
  const { view, actions } = useFixture(make)
  return <PartScope width="21rem" height="60rem"><KnobsPanel view={view} actions={actions} sheet={false} /></PartScope>
}
export default function Ready() { return <Knobs make={knobsView} /> }
export function Finding() { return <Knobs make={knobsFindingView} /> }
export function Idle() { return <Knobs make={() => ({ ...knobsView(), knobs: { _tag: "Idle", message: "Pick a part to see its knobs." } })} /> }
