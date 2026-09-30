import { DraftButton } from "./DraftButton"
import { PartScope } from "../fixtures/PartScope"

export const name = "Draft button"
export const note = "The draft's count at the right of the bar. It unfolds the draft; a warn dot says something stops Send."

export default function Folded() {
  return <PartScope><DraftButton marks={5} open={false} blocked={false} onDraftOpen={() => undefined} /></PartScope>
}
export function Open() {
  return <PartScope><DraftButton marks={5} open blocked={false} onDraftOpen={() => undefined} /></PartScope>
}
export function Blocked() {
  return <PartScope><DraftButton marks={1} open={false} blocked onDraftOpen={() => undefined} /></PartScope>
}
