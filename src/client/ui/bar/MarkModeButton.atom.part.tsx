import { MarkModeButton } from "./MarkModeButton"
import { PartScope } from "../fixtures/PartScope"

export const name = "Mark mode button"
export const note = "The pin button at the left of the bar, filled while mark mode is on. M turns it on and off."

export default function Off() {
  return <PartScope><MarkModeButton mode={{ _tag: "Off" }} availability={{ _tag: "Enabled" }} onMarkMode={() => undefined} /></PartScope>
}
export function On() {
  return <PartScope><MarkModeButton mode={{ _tag: "Marking" }} availability={{ _tag: "Enabled" }} onMarkMode={() => undefined} /></PartScope>
}
export function NothingToMark() {
  return <PartScope><MarkModeButton mode={{ _tag: "Off" }} availability={{ _tag: "Disabled", reason: "The real files cannot be marked yet. Mark a take." }} onMarkMode={() => undefined} /></PartScope>
}
