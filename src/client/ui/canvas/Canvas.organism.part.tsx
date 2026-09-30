import { Canvas } from "./Canvas"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { errorView, gridView, noneView, planView, planningView, runningView, takesView } from "../fixtures/views"
import type { ChromeView } from "../contract"

export const name = "Canvas"
export const note = "The real files and each take in one grid, one gap apart; a plan's directions wait in their slots."

function Scene({ make }: { readonly make: () => ChromeView }) {
  const { view, actions } = useFixture(make)
  return <PartScope width="75rem" height="46rem"><Canvas view={view} actions={actions} /></PartScope>
}
export default function Takes() { return <Scene make={takesView} /> }
export function AllStates() { return <Scene make={gridView} /> }
export function Plan() { return <Scene make={planView} /> }
export function Planning() { return <Scene make={planningView} /> }
export function Running() { return <Scene make={runningView} /> }
export function Throws() { return <Scene make={errorView} /> }
export function Nothing() { return <Scene make={noneView} /> }
