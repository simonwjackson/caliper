import { NoteText } from "./NoteText"
import { PartScope } from "../fixtures/PartScope"

export const name = "Note text"
export const note = "A note with the mark names it points to set apart as small bordered tokens. The text itself is never rewritten."

const line = { fontSize: 12, lineHeight: 1.45, color: "var(--dr-ink)" } as const
export default function Pointing() {
  return <PartScope width="18rem"><p style={line}><NoteText text="Too heavy. Thin the border to one pixel, like 0A" names={["0A"]} /></p></PartScope>
}
export function Several() {
  return <PartScope width="18rem"><p style={line}><NoteText text="Restore 0A here, with the spacing of 3A" names={["0A", "3A"]} /></p></PartScope>
}
export function NoNames() {
  return <PartScope width="18rem"><p style={line}><NoteText text="Love this. Keep 6A as it is." names={[]} /></p></PartScope>
}
