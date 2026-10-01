import { Board } from "./Board"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { FIXTURES } from "../fixtures/views"
import type { ChromeView } from "../contract"

export const name = "Workspace board"
export const note = "Decision 45: a row for each pinned state, Today and each idea as columns; pickers hold what does not fit."

function Scene({ make, width = "75rem", height = "46rem" }: { readonly make: () => ChromeView; readonly width?: string; readonly height?: string }) {
  const { view, actions } = useFixture(make)
  return <PartScope width={width} height={height}><Board view={view} actions={actions} /></PartScope>
}
export default function Compared() { return <Scene make={FIXTURES.workspaceBoard} /> }
export function NewWorkspace() { return <Scene make={FIXTURES.workspaceNew} /> }
export function Framed() { return <Scene make={FIXTURES.workspaceFrame} /> }
export function Planning() { return <Scene make={FIXTURES.workspacePlanning} /> }
export function Working() { return <Scene make={FIXTURES.workspaceRunning} /> }
export function Closed() { return <Scene make={FIXTURES.workspaceClosed} /> }
/** Today beside one idea, with a picker for the others. */
export function Narrow() { return <Scene make={FIXTURES.workspaceBoard} width="26rem" /> }
/** One row at a time, its picker beside the cells. */
export function Short() { return <Scene make={FIXTURES.workspaceBoard} width="75rem" height="18rem" /> }
