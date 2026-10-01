import { useState } from "react"
import { OpenQuestion } from "./OpenQuestion"
import { PartScope } from "../fixtures/PartScope"
import type { QuestionView } from "../contract"

export const name = "Open question"
export const note = "A question still open, and who asked it. Answer unfolds the answer and its reason; both are needed."

const asked: Extract<QuestionView, { _tag: "Open" }> = { _tag: "Open", id: "2", text: "Should the hint bar also name the menu and options buttons?", by: "You · 1 Oct" }
function Scene({ answering = false, question = asked }: { readonly answering?: boolean; readonly question?: Extract<QuestionView, { _tag: "Open" }> }) {
  const [open, setOpen] = useState<string | null>(answering ? question.id : null)
  return <PartScope width="20rem"><ul className="ws-q__list">
    <OpenQuestion question={question} answering={open === question.id} answer={{ _tag: "Enabled" }} onAnswering={setOpen} actions={{ onAnswer: () => setOpen(null) }} />
  </ul></PartScope>
}
export default function Open() { return <Scene /> }
export function Answering() { return <Scene answering /> }
export function FromAnIdea() { return <Scene question={{ _tag: "Open", id: "3", text: "In Settings is a cart, the readout says 7 carts and the tally says 1/9. Do Korri's places count as carts?", by: "Idea 3: Settings is a cart · 1 Oct" }} /> }
