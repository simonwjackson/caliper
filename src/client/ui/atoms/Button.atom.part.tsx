import { Button } from "./Button"
import { PartScope } from "../fixtures/PartScope"
import { CAL } from "../hooks"

export const name = "Button"
export const note = "The one button. Ink for the primary action; a disabled button says why in its title."

export default function Plain() {
  return <PartScope><span style={{ display: "flex", gap: ".4rem" }}>
    <Button tone="primary" hook={CAL.accept} onClick={() => undefined}>Accept</Button>
    <Button hook={CAL.discard} onClick={() => undefined}>Discard</Button>
    <Button tone="quiet" onClick={() => undefined}>Quiet</Button>
    <Button tone="link" onClick={() => undefined}>A link</Button>
  </span></PartScope>
}
export function Disabled() {
  return <PartScope><span style={{ display: "flex", gap: ".4rem" }}>
    <Button tone="primary" availability={{ _tag: "Disabled", reason: "Wait for the agent, or stop it" }} onClick={() => undefined}>Accept</Button>
    <Button small availability={{ _tag: "Disabled", reason: "Read only while the agent works" }} onClick={() => undefined}>Save</Button>
  </span></PartScope>
}
