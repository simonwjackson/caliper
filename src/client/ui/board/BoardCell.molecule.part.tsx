import type { CSSProperties } from "react"
import { BoardCell } from "./BoardCell"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { FIXTURES } from "../fixtures/views"
import type { ChromeView } from "../contract"

export const name = "Board cell"
export const note = "One row in one column: the page, a plate while its idea works, or the page stepped back when it shows exactly what Today shows."

const scale = 0.75
function Scene({ make, row = 0, column = 2, missing = false }: { readonly make: () => ChromeView; readonly row?: number; readonly column?: number; readonly missing?: boolean }) {
  const { view, actions } = useFixture(make)
  const board = view.workspace
  if (board._tag !== "Open") return null
  const shownRow = board.rows[row], shownColumn = board.columns[column]
  if (!shownRow || !shownColumn) return null
  const cell = missing ? undefined : board.cells.find(item => item.row === shownRow.key && item.column === shownColumn.key)
  const size = { "--ws-cell-w": `${279 * scale}px`, "--ws-cell-h": `${209 * scale}px` } as CSSProperties
  return <PartScope width="16rem"><div style={size}>
    <BoardCell column={shownColumn} cell={cell} row={missing ? { ...shownRow, missing: true } : shownRow} picking={false}
      css={{ width: view.device.cssWidth, height: view.device.cssHeight }} scale={279 * scale / view.device.cssWidth} fit={75} actions={actions} />
  </div></PartScope>
}
export default function Changed() { return <Scene make={FIXTURES.workspaceBoard} /> }
export function SameAsToday() { return <Scene make={FIXTURES.workspaceBoard} row={1} column={1} /> }
export function Today() { return <Scene make={FIXTURES.workspaceBoard} column={0} /> }
export function Working() { return <Scene make={FIXTURES.workspaceRunning} /> }
export function Planned() { return <Scene make={FIXTURES.workspacePlanning} column={1} /> }
export function StateGone() { return <Scene make={FIXTURES.workspaceBoard} missing /> }
