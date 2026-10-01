import type { RowCheckView } from "../contract"
import { Icon } from "../atoms/Icon"
import "../tokens.css"
import "./board.css"

const WORDS = { Passed: "Passes", Failed: "Fails", Inconclusive: "Inconclusive", NotRun: "Not run", Waiting: "Waiting", Running: "Checking" } as const

/**
 * One named check of a row, in one column: its result as a sign and a word,
 * its name and source line, what went wrong, and the page at its end. A
 * check's own defect looks like a failure of an idea, so its source line is
 * one glance away.
 */
export function RowCheck({ check, column, file }: { readonly check: RowCheckView; readonly column: string; readonly file: string }) {
  const result = check.results.find(item => item.column === column)
  const status = result?.status ?? "NotRun"
  return <li className="ws-rc" data-status={status}>
    <p className="ws-rc__head">
      <span className="ws-rc__sign">{status === "Passed" ? <Icon name="checks" /> : status === "Failed" ? <Icon name="close" />
        : status === "Running" ? <i className="dr-dot dr-dot--running" aria-hidden="true" /> : <i className="ws-rc__none" aria-hidden="true" />}<span className="dr-sr">{WORDS[status]}: </span></span>
      <b className="ws-rc__name">{check.name}</b>
      <code className="ws-rc__line" title={`${file}, line ${check.line}`}>line {check.line}</code>
    </p>
    {result && result.status !== "Passed" && result.detail && <p className="ws-rc__detail">{result.detail}</p>}
    {result?.image && <img className="ws-rc__image" src={result.image} alt={`The page at the end of "${check.name}"`} />}
  </li>
}
