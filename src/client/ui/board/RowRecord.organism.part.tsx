import { RowRecord } from "./RowRecord"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { FIXTURES } from "../fixtures/views"
import type { ChromeView } from "../contract"

export const name = "Row record"
export const note = "Workspaces slice 2: what you asked the row agent, the row's file, its checks in one column at a time, and the agent's log."

function Scene({ make }: { readonly make: () => ChromeView }) {
  const { view, actions } = useFixture(make)
  return <PartScope width="21rem" height="44rem"><RowRecord view={view} actions={actions} sheet={false} /></PartScope>
}
export default function Checked() { return <Scene make={FIXTURES.workspaceRowChecked} /> }
export function Checking() { return <Scene make={FIXTURES.workspaceRowChecking} /> }
export function Writing() { return <Scene make={FIXTURES.workspaceRowWriting} /> }
