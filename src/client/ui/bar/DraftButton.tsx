import { CAL } from "../hooks"
import { Icon } from "../atoms/Icon"
import "../tokens.css"
import "../atoms/atoms.css"
import "./bar.css"

export type DraftButtonProps = {
  readonly marks: number
  readonly open: boolean
  /** Something in the draft stops Send: a lost mark, a running take. The draft says what. */
  readonly blocked: boolean
  readonly onDraftOpen: (open: boolean) => void
}

/** "5 marks" at the right of the bar. It unfolds the draft above the bar and folds it again. */
export function DraftButton({ marks, open, blocked, onDraftOpen }: DraftButtonProps) {
  const label = `${marks} ${marks === 1 ? "mark" : "marks"}`
  return <button type="button" className="dr-btn dr-draftbtn" data-cal={CAL.draftOpen} aria-expanded={open} data-blocked={blocked || undefined}
    title={blocked ? `${label}. Something stops Send; open the draft to see what.` : open ? "Fold the draft" : "Show the draft"} onClick={() => onDraftOpen(!open)}>
    {blocked && <i className="dr-dot dr-dot--warn" aria-hidden="true" />}{label}<Icon name="chevron" />
  </button>
}
