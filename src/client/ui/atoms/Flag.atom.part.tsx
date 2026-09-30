import { Flag } from "./Flag"
import { PartScope } from "../fixtures/PartScope"
import type { AcceptFlag } from "../contract"

export const name = "Accept flag"
export const note = "A take made before a later accept that touched its part or files: warns in the warn colour, never blocks."

const flag: AcceptFlag = {
  _tag: "Before", take: "8", label: "made before take 8 was accepted",
  detail: "Take 8 changed src/atoms/PicoButton.css after this take was made. Accepting this take can undo that.",
}

export default function Folded() { return <PartScope width="20rem"><Flag flag={flag} variant="Fold" /></PartScope> }
export function Full() { return <PartScope width="20rem"><Flag flag={flag} variant="Full" /></PartScope> }
