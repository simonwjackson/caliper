import type { BoardCellView, BoardColumnView, BoardRowView, ChromeActions } from "../contract"
import { CAL } from "../hooks"
import { BoardCell } from "./BoardCell"
import "../tokens.css"
import "./board.css"

/**
 * One row of the board: the pinned state's name, then its cell in each
 * column on screen. While a picker holds the rows, the picker names it. A
 * row whose state is gone says so, and offers Unpin, because the parts
 * list no longer has its pin.
 */
export function BoardRow({ row, columns, cells, picking, open, css, scale, fit, actions }: {
  readonly row: BoardRowView; readonly columns: readonly BoardColumnView[]; readonly cells: readonly BoardCellView[]; readonly picking: boolean; readonly open: boolean
  readonly css: { readonly width: number; readonly height: number }; readonly scale: number; readonly fit: number
  readonly actions: Pick<ChromeActions, "onPin" | "onFrameMount" | "onFrameGeometry">
}) {
  return <section className="ws-row" aria-label={`${row.part}, ${row.state}`}>
    {!picking && <h2 className="ws-row__head" title={row.site}><b>{row.part}</b><span>{row.state}</span>
      {row.missing && open && <button type="button" className="ws-row__unpin" data-cal={CAL.pin} data-part={row.ref.part} data-state={row.ref.state} onClick={() => actions.onPin(row.ref, false)}>Unpin</button>}
    </h2>}
    <div className="ws-row__cells">{columns.map(column => <BoardCell key={column.key} column={column} cell={cells.find(item => item.row === row.key && item.column === column.key)}
      row={row} picking={picking} css={css} scale={scale} fit={fit} actions={actions} />)}</div>
  </section>
}
