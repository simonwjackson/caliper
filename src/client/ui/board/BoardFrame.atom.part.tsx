import type { CSSProperties } from "react"
import { BoardFrame } from "./BoardFrame"
import { PartScope } from "../fixtures/PartScope"
import { FIXTURES } from "../fixtures/views"
import type { FrameView } from "../contract"

export const name = "Board frame"
export const note = "One cell's page at the device's CSS viewport, scaled into the cell; a page that failed or renders nothing says so."

const NOOP = { onFrameMount: () => {}, onFrameGeometry: () => {} }
const scale = 0.75
function Scene({ change = frame => frame }: { readonly change?: (frame: FrameView) => FrameView }) {
  const board = FIXTURES.workspaceBoard().workspace
  const frame = board._tag === "Open" ? board.cells.find(cell => cell.frame?.take === "2")?.frame : undefined
  if (!frame) return null
  const size = { width: 279 * scale, height: 209 * scale } as CSSProperties
  return <PartScope width="16rem"><div className="ws-cell__screen" style={size}>
    <BoardFrame frame={change(frame)} css={{ width: 640, height: 480 }} scale={279 * scale / 640} fit={75} actions={NOOP} />
  </div></PartScope>
}
export default function Rendered() { return <Scene /> }
export function Failed() { return <Scene change={frame => ({ ...frame, verdict: { _tag: "Failed" }, problems: [{ kind: "error", title: "PicoHome threw", detail: "TypeError" }] })} /> }
export function Empty() { return <Scene change={frame => ({ ...frame, verdict: { _tag: "Empty" } })} /> }
