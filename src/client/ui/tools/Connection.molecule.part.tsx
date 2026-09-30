import { Connection } from "./Connection"
import { PartScope } from "../fixtures/PartScope"

export const name = "Connection"
export const note = "Silent while ready; a quiet line while connecting; a bad line when Vite is gone."

export default function Unreachable() {
  return <PartScope width="30rem" height="3rem"><Connection connection={{ _tag: "Unreachable", reason: "Vite stopped answering at 13:52. Caliper retries every 2 seconds." }} /></PartScope>
}
export function Connecting() {
  return <PartScope width="30rem" height="3rem"><Connection connection={{ _tag: "Connecting" }} /></PartScope>
}
