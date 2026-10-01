import type { CSSProperties } from "react"
import { BoardRow } from "./BoardRow"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { FIXTURES } from "../fixtures/views"
import type { BoardRowView, ChromeView } from "../contract"

export const name = "Board row"
export const note = "One pinned state: its name, then its cell in each column on screen. A state that is gone offers Unpin."

const scale = 0.5
function Scene({ make, row = 0, change = item => item }: { readonly make: () => ChromeView; readonly row?: number; readonly change?: (row: BoardRowView) => BoardRowView }) {
  const { view, actions } = useFixture(make)
  const board = view.workspace
  if (board._tag !== "Open") return null
  const shown = board.rows[row]
  if (!shown) return null
  const cells = { "--ws-cell-w": `${279 * scale}px`, "--ws-cell-h": `${209 * scale}px`, "--ws-cols": board.columns.length, "--ws-gap": "16px", "--ws-row-head": "34px" } as CSSProperties
  return <PartScope width="44rem"><div className="ws-board" style={{ ...cells, padding: 0 }}>
    <BoardRow row={change(shown)} columns={board.columns} cells={board.cells} picking={false} open css={{ width: view.device.cssWidth, height: view.device.cssHeight }}
      scale={279 * scale / view.device.cssWidth} fit={50} actions={actions} />
  </div></PartScope>
}
export default function Find() { return <Scene make={FIXTURES.workspaceBoard} row={1} /> }
export function Home() { return <Scene make={FIXTURES.workspaceBoard} /> }
export function Working() { return <Scene make={FIXTURES.workspaceRunning} /> }
export function Gone() { return <Scene make={FIXTURES.workspaceBoard} change={row => ({ ...row, missing: true })} /> }
