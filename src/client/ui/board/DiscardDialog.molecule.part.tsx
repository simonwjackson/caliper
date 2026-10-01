import { useState } from "react"
import { DiscardDialog } from "./DiscardDialog"
import { PartScope } from "../fixtures/PartScope"
import type { BoardView } from "../contract"

export const name = "Discard dialog"
export const note = "What Discard deletes (the ideas and their files) and what stays (the question and every question and answer)."

type Discard = Extract<BoardView, { _tag: "Open" }>["discard"]
function Scene({ discard }: { readonly discard: Discard }) {
  const [open, setOpen] = useState(true)
  return <PartScope width="30rem" height="16rem">
    {open ? <DiscardDialog discard={discard} onCancel={() => setOpen(false)} onDiscard={() => setOpen(false)} /> : <p>Closed. The scenario keeps no workspace to discard.</p>}
  </PartScope>
}
export default function ThreeIdeas() { return <Scene discard={{ availability: { _tag: "Enabled" }, ideas: 3, files: 6, answered: 1, open: 2 }} /> }
export function NoIdeas() { return <Scene discard={{ availability: { _tag: "Enabled" }, ideas: 0, files: 0, answered: 0, open: 1 }} /> }
