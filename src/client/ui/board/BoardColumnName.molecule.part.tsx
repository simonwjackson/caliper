import { useState } from "react"
import { BoardColumnName } from "./BoardColumnName"
import { PartScope } from "../fixtures/PartScope"
import type { BoardColumnView } from "../contract"

export const name = "Board column name"
export const note = "Today, a planned plate, or an idea: its name focuses it; under it, its files or that it works, and the strange tag."

function Scene({ column }: { readonly column: BoardColumnView }) {
  const [focused, setFocused] = useState(column._tag === "Idea" && column.focused)
  const shown = column._tag === "Idea" ? { ...column, focused } : column
  return <PartScope width="16rem"><div className="ws-head"><BoardColumnName column={shown} actions={{ onIdea: take => setFocused(take !== null) }} /></div></PartScope>
}
const idea: Extract<BoardColumnView, { _tag: "Idea" }> = { _tag: "Idea", key: "idea:2", take: "2", name: "Places in every header", brief: "Find and Settings beside the clock.", strange: false, run: { _tag: "Idle" }, files: 2, focused: false }
export default function Idea() { return <Scene column={idea} /> }
export function Focused() { return <Scene column={{ ...idea, focused: true }} /> }
export function Strange() { return <Scene column={{ ...idea, take: "3", name: "Settings is a cart", strange: true }} /> }
export function Working() { return <Scene column={{ ...idea, run: { _tag: "Running" } }} /> }
export function Stopped() { return <Scene column={{ ...idea, run: { _tag: "Failed", reason: "The model request failed." } }} /> }
export function Today() { return <Scene column={{ _tag: "Today", key: "today" }} /> }
export function Planned() { return <Scene column={{ _tag: "Planned", key: "planned:0" }} /> }
