import { PlanSlot } from "./PlanSlot"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { planView } from "../fixtures/views"

export const name = "Plan slot"
export const note = "A direction waiting where its take will appear. The strange one has a dashed edge."

function Slot({ index }: { readonly index: number }) {
  const { view, actions } = useFixture(planView)
  const item = view.plan._tag === "Review" ? view.plan.directions[index] : undefined
  return <PartScope width="279px">{item && <PlanSlot _tag="Direction" id={item.id} index={index} direction={item.direction} actions={actions} />}</PartScope>
}
export default function Direction() { return <Slot index={0} /> }
export function Strange() { return <Slot index={2} /> }
export function Planning() {
  return <PartScope width="279px"><div style={{ ["--dr-col" as string]: "279px", ["--dr-row" as string]: "209px" }}><PlanSlot _tag="Planning" index={0} message="Planning 3 directions" /></div></PartScope>
}
