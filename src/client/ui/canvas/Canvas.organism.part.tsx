import { Canvas } from "./Canvas"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import {
  chainHistoryView, chainsAcceptedView, chainsOdinView, errorView, gridView, markView, markedView, noneView, planView, planningView, replacingView, runningView, takesView,
} from "../fixtures/views"
import type { ChromeView } from "../contract"

export const name = "Canvas"
export const note = "The real files, then each chain of takes as its head and pair, one gap apart; a plan's directions wait in their slots."

function Scene({ make, width = "75rem" }: { readonly make: () => ChromeView; readonly width?: string }) {
  const { view, actions } = useFixture(make)
  return <PartScope width={width} height="46rem"><Canvas view={view} actions={actions} /></PartScope>
}
export default function Takes() { return <Scene make={takesView} /> }
export function AllStates() { return <Scene make={gridView} /> }
export function Plan() { return <Scene make={planView} /> }
export function Planning() { return <Scene make={planningView} /> }
export function Running() { return <Scene make={runningView} /> }
export function Throws() { return <Scene make={errorView} /> }
export function Nothing() { return <Scene make={noneView} /> }
export function MarkMode() { return <Scene make={markView} /> }
export function Marked() { return <Scene make={markedView} /> }
export function Replacing() { return <Scene make={replacingView} /> }
export function ChainHistory() { return <Scene make={chainHistoryView} /> }
export function AfterAccept() { return <Scene make={chainsAcceptedView} /> }
/** One frame of each chain: two frames and a gap do not fit 30 rem at true size. */
export function NoRoomForPairs() { return <Scene make={takesView} width="30rem" /> }
export function OdinChains() { return <Scene make={chainsOdinView} /> }
