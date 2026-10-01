import type { BoardColumnView, ChromeActions } from "../contract"
import { CAL } from "../hooks"
import "../tokens.css"
import "./board.css"

/** A column's name in a picker: Today, or the idea's number. */
export const columnShort = (column: BoardColumnView) => column._tag === "Today" ? "Today" : column._tag === "Idea" ? column.take : "…"
/** A column's whole name, for a picker's title. */
export const columnTitle = (column: BoardColumnView) => column._tag === "Today" ? "Today: the real files" : column._tag === "Idea" ? `Idea ${column.take}: ${column.name}` : "Being planned"

/**
 * The name over a column of the board. An idea's name focuses it, so the bar
 * talks to it; under the name, its files or that its agent works, and the
 * strange direction's dashed tag (decision 33). A planned column is a blank plate.
 */
export function BoardColumnName({ column, actions }: { readonly column: BoardColumnView; readonly actions: Pick<ChromeActions, "onIdea"> }) {
  if (column._tag === "Today") return <div className="ws-head__name"><b>Today</b><span className="ws-head__meta">Real files</span></div>
  if (column._tag === "Planned") return <div className="ws-head__name"><b>…</b><span className="dr-slot__pending ws-head__pending" aria-label="Being planned" /></div>
  const running = column.run._tag === "Running"
  return <div className="ws-head__name">
    <button type="button" className="ws-head__idea" data-cal={CAL.boardIdea} data-take={column.take} aria-current={column.focused || undefined}
      title={column.brief || column.name} onClick={() => actions.onIdea(column.focused ? null : column.take)}>
      {running && <i className="dr-dot dr-dot--running ws-head__run" aria-label="Working" />}<b>{column.take}</b><span>{column.name}</span>
    </button>
    <span className="ws-head__meta">
      {running ? "Working" : column.run._tag === "Failed" ? <span className="ws-head__failed" title={column.run.reason}>Stopped</span> : `${column.files} ${column.files === 1 ? "file" : "files"}`}
      {column.strange && <span className="ws-strange">strange</span>}
    </span>
  </div>
}
