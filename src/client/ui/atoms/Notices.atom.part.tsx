import { Notices } from "./Notices"
import { PartScope } from "../fixtures/PartScope"

export const name = "Notices"
export const note = "Errors are alerts; warnings and information are status lines."

export default function Mixed() {
  return <PartScope><Notices notices={[
    { kind: "info", text: "Editing Game Detail, previewed inside Home's shelf." },
    { kind: "warning", text: "reference.png is 6 MB; images can be at most 5 MB." },
    { kind: "error", text: "The prompt could not be sent: Vite is not reachable." },
  ]} /></PartScope>
}
