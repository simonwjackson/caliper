import type { CellChecksView } from "../contract"
import { CAL } from "../hooks"
import { Icon } from "../atoms/Icon"
import "../tokens.css"
import "./board.css"

/** What the line says, and its tone. A sign and a word carry the result, never colour alone. */
export function checkWords(checks: CellChecksView): { readonly text: string; readonly tone: "good" | "bad" | "quiet" | "running" | "warn" } {
  if (checks._tag === "NotRun") return { text: "Not checked", tone: "quiet" }
  if (checks._tag === "Waiting") return { text: "Waiting to check", tone: "quiet" }
  if (checks._tag === "Running") return { text: "Checking", tone: "running" }
  if (checks._tag === "Unknown") return { text: "Could not check", tone: "warn" }
  if (checks._tag === "Done") {
    const counted = `${checks.passed} of ${checks.total} ${checks.total === 1 ? "check passes" : "checks pass"}`
    if (checks.stale) return { text: `Out of date · ${counted}`, tone: "quiet" }
    return { text: counted, tone: checks.passed === checks.total ? "good" : "bad" }
  }
  return { text: "", tone: "quiet" }
}

/**
 * The line under a cell that says how the row's checks went in that
 * column (workspaces slice 2). It opens the row's record with this column's
 * results unfolded. A row with no checks has no line.
 */
export function CheckLine({ checks, label, onOpen }: { readonly checks: CellChecksView; readonly label: string; readonly onOpen: () => void }) {
  if (checks._tag === "None") return null
  const { text, tone } = checkWords(checks)
  return <button type="button" className="ws-check" data-cal={CAL.cellChecks} data-tone={tone}
    title={checks._tag === "Unknown" ? checks.reason : `Open the checks of ${label}`} onClick={onOpen}>
    {tone === "good" && <Icon name="checks" />}
    {tone === "bad" && <Icon name="close" />}
    {tone === "running" && <i className="dr-dot dr-dot--running" aria-hidden="true" />}
    <span>{text}</span>
  </button>
}
