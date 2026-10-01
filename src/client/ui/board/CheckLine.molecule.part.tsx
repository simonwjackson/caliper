import type { CSSProperties } from "react"
import { CheckLine } from "./CheckLine"
import { PartScope } from "../fixtures/PartScope"
import type { CellChecksView } from "../contract"

export const name = "Check line"
export const note = "Workspaces slice 2: the line under a cell, a sign and a count in the colour of the result. It opens the row's record."

function Scene({ checks }: { readonly checks: CellChecksView }) {
  const size = { "--ws-check-line": "24px", width: "209px" } as CSSProperties
  return <PartScope width="16rem"><div style={size}><CheckLine checks={checks} label="Home by d-pad, A and B in Today" onOpen={() => undefined} /></div></PartScope>
}
export default function Passes() { return <Scene checks={{ _tag: "Done", passed: 2, total: 2, stale: false }} /> }
export function Fails() { return <Scene checks={{ _tag: "Done", passed: 0, total: 2, stale: false }} /> }
export function OneCheck() { return <Scene checks={{ _tag: "Done", passed: 1, total: 1, stale: false }} /> }
export function OutOfDate() { return <Scene checks={{ _tag: "Done", passed: 2, total: 2, stale: true }} /> }
export function Checking() { return <Scene checks={{ _tag: "Running" }} /> }
export function Waiting() { return <Scene checks={{ _tag: "Waiting" }} /> }
export function NotChecked() { return <Scene checks={{ _tag: "NotRun" }} /> }
export function CouldNotCheck() { return <Scene checks={{ _tag: "Unknown", reason: "Chromium's product page crashed." }} /> }
