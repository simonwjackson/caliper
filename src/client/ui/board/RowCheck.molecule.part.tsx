import { RowCheck } from "./RowCheck"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { FIXTURES } from "../fixtures/views"
import type { ChromeView } from "../contract"

export const name = "Row check"
export const note = "Workspaces slice 2: one named check in one column, with its source line, what went wrong, and the page at its end."

function Scene({ make, column, index = 0 }: { readonly make: () => ChromeView; readonly column: string; readonly index?: number }) {
  const { view } = useFixture(make)
  const board = view.workspace
  if (board._tag !== "Open" || board.record._tag !== "Open") return null
  const check = board.record.checks[index]
  if (!check) return null
  return <PartScope width="21rem"><ul className="ws-rec__list"><RowCheck check={check} column={column} file={board.record.file} /></ul></PartScope>
}
export default function Fails() { return <Scene make={FIXTURES.workspaceRowChecked} column="today" /> }
export function Passes() { return <Scene make={FIXTURES.workspaceRowChecked} column="idea:6" index={1} /> }
export function Checking() { return <Scene make={FIXTURES.workspaceRowChecking} column="idea:5" /> }
export function Waiting() { return <Scene make={FIXTURES.workspaceRowChecking} column="idea:7" /> }
