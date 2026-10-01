import { useState } from "react"
import { BoardPicker } from "./BoardPicker"
import { PartScope } from "../fixtures/PartScope"

export const name = "Board picker"
export const note = "The columns or rows that do not fit the board, each with its real label, one press away."

function Scene({ vertical = false, options }: { readonly vertical?: boolean; readonly options: readonly { readonly id: string; readonly label: string }[] }) {
  const [value, setValue] = useState(options[0]?.id ?? null)
  return <PartScope width={vertical ? "7rem" : "20rem"}><BoardPicker label="Column" vertical={vertical} value={value} options={options} onPick={setValue} /></PartScope>
}
export default function Ideas() { return <Scene options={[{ id: "1", label: "1" }, { id: "2", label: "2" }, { id: "3", label: "3" }]} /> }
export function Columns() { return <Scene options={[{ id: "today", label: "Today" }, { id: "1", label: "1" }, { id: "2", label: "2" }, { id: "3", label: "3" }]} /> }
export function RowsBeside() { return <Scene vertical options={[{ id: "home", label: "Home" }, { id: "find", label: "Find" }, { id: "settings", label: "Settings" }]} /> }
