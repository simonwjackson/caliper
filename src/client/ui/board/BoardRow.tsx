import type { BoardCellView, BoardColumnView, BoardRowView, ChromeActions } from "../contract"
import { CAL } from "../hooks"
import { BoardCell } from "./BoardCell"
import "../tokens.css"
import "./board.css"

/** What the row's name says beside it: its state, or for a scratch row its agent and its checks. */
function rowMeta(row: BoardRowView): string {
  const checks = row.checks === 0 ? "" : row.checks === 1 ? "1 check" : `${row.checks} checks`
  if (!row.scratch) return [row.state, checks].filter(Boolean).join(" · ")
  if (row.scratch.run._tag === "Running") return row.scratch.written ? "Scratch · writing" : "Scratch · being written"
  if (row.scratch.run._tag === "Failed") return "Scratch · stopped"
  return ["Scratch", checks].filter(Boolean).join(" · ")
}

/**
 * One row of the board: its name, then its cell in each column on screen.
 * While a picker holds the rows, the picker names it. The name of a row with
 * checks, or of a scratch row, opens the row's record; a scratch row is then
 * focused, so the bar talks to its agent. A row whose state is gone says
 * so, and offers Unpin, because the parts list no longer has its pin.
 */
export function BoardRow({ row, columns, cells, picking, open, css, scale, fit, actions }: {
  readonly row: BoardRowView; readonly columns: readonly BoardColumnView[]; readonly cells: readonly BoardCellView[]; readonly picking: boolean; readonly open: boolean
  readonly css: { readonly width: number; readonly height: number }; readonly scale: number; readonly fit: number
  readonly actions: Pick<ChromeActions, "onPin" | "onFrameMount" | "onFrameGeometry" | "onRowRecord">
}) {
  const opens = row.scratch !== null || row.checks > 0
  const running = row.scratch?.run._tag === "Running"
  return <section className="ws-row" aria-label={`${row.part}, ${row.state}`} data-scratch={row.scratch ? "" : undefined}>
    {!picking && <h2 className="ws-row__head" title={row.site}>
      {opens
        ? <button type="button" className="ws-row__name" data-cal={CAL.boardRow} data-row={row.key} aria-expanded={row.open}
          aria-current={row.scratch?.focused || undefined} onClick={() => actions.onRowRecord(row.open ? null : row.key)}>
          {running && <i className="dr-dot dr-dot--running" aria-hidden="true" />}<b>{row.part}</b><span>{rowMeta(row)}</span>
        </button>
        : <><b>{row.part}</b><span>{rowMeta(row)}</span></>}
      {row.missing && open && !row.scratch && <button type="button" className="ws-row__unpin" data-cal={CAL.pin} data-part={row.ref.part} data-state={row.ref.state} onClick={() => actions.onPin(row.ref, false)}>Unpin</button>}
    </h2>}
    <div className="ws-row__cells">{columns.map(column => <BoardCell key={column.key} column={column} cell={cells.find(item => item.row === row.key && item.column === column.key)}
      row={row} picking={picking} css={css} scale={scale} fit={fit} actions={actions} />)}</div>
  </section>
}
