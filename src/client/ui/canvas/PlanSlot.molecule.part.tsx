import { PlanSlot } from "./PlanSlot"
import { PartScope } from "../fixtures/PartScope"

export const name = "Plan slot"
export const note = "A take being planned, in the place its take will fill. It carries no words."

export default function Planning() {
  return <PartScope width="279px"><div style={{ ["--dr-col" as string]: "279px", ["--dr-row" as string]: "209px" }}><PlanSlot index={0} /></div></PartScope>
}
