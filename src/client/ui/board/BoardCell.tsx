import type { BoardCellView, BoardColumnView, BoardRowView, ChromeActions } from "../contract"
import { CAL } from "../hooks"
import { BoardFrame } from "./BoardFrame"
import "../tokens.css"
import "./board.css"

/**
 * One row in one column. While its column is planned or its idea's agent
 * works, a plate waits. A cell that shows exactly what Today shows steps
 * back and says so, so the cells that changed are the ones you read.
 */
export function BoardCell({ column, cell, row, picking, css, scale, fit, actions }: {
  readonly column: BoardColumnView; readonly cell: BoardCellView | undefined; readonly row: BoardRowView; readonly picking: boolean
  readonly css: { readonly width: number; readonly height: number }; readonly scale: number; readonly fit: number
  readonly actions: Pick<ChromeActions, "onFrameMount" | "onFrameGeometry">
}) {
  const run = column._tag === "Planned" ? "Planning" : column._tag === "Idea" && column.run._tag === "Running" ? "Running" : "Ready"
  const frame = cell?.frame ?? null
  const same = cell?.same === true
  const name = column._tag === "Today" ? "Today" : column._tag === "Idea" ? `Idea ${column.take}` : "A planned idea"
  return <figure className="ws-cell" data-cal={CAL.boardCell} data-column={column.key} data-same={same || undefined} data-focus={column._tag === "Idea" && column.focused || undefined}
    data-run={run} data-verdict={frame?.verdict._tag} aria-label={`${row.part}, ${row.state}, ${name}`}>
    <div className="ws-cell__screen">
      {frame ? <BoardFrame frame={frame} css={css} scale={scale} fit={fit} actions={actions} />
        : row.missing ? <p className="ws-cell__verdict">This state no longer exists</p>
          : <div className="dr-working" aria-hidden="true" />}
    </div>
    {same && <figcaption className="ws-cell__note">Same as Today</figcaption>}
    {picking && <span className="dr-sr">{name}</span>}
  </figure>
}
