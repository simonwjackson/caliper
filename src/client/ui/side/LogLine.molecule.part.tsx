import { LogLine } from "./LogLine"
import { PartScope } from "../fixtures/PartScope"
import { PICO_GAME_DETAIL } from "../fixtures/pico"

export const name = "Log line"
export const note = "One line of a take's conversation."

export default function Conversation() {
  return <PartScope width="19rem"><ol className="dr-log" style={{ borderTop: 0 }}>
    <LogLine entry={{ _tag: "User", text: "Match the attached screenshot's spacing.", images: [{ name: "reference.png", url: PICO_GAME_DETAIL }] }} />
    <LogLine entry={{ _tag: "Tool", name: "read", subject: "PicoGameDetail.css", outcome: "Done", detail: "" }} />
    <LogLine entry={{ _tag: "Assistant", text: "I will tighten the gap between the facts." }} />
    <LogLine entry={{ _tag: "Edit", file: "src/pages/PicoGameDetail.css" }} />
    <LogLine entry={{ _tag: "Tool", name: "edit", subject: "PicoGameDetail.tsx", outcome: "Running", detail: "" }} />
    <LogLine entry={{ _tag: "Tool", name: "render", subject: "Default on RG353M", outcome: "Failed", detail: "the part threw while rendering" }} />
  </ol></PartScope>
}
