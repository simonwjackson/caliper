import { useRef, useState } from "react"
import type { CSSProperties } from "react"
import type { ChromeActions, ChromeView } from "../contract"
import type { FrameGeometry } from "../../device-frame.js"
import { CAL } from "../hooks"
import { useBox } from "../useBox"
import { Button } from "../atoms/Button"
import { Caption } from "../canvas/Caption"
import { COLUMN_HEAD, COMPACT_HEAD, GAP, PICKER_H, PICK_ITEM_H, ROW_HEAD, ROW_PICK_W, planBoard } from "./plan-board"
import { BoardColumnName, columnShort, columnTitle } from "./BoardColumnName"
import { BoardPicker } from "./BoardPicker"
import { BoardRow } from "./BoardRow"
import "../tokens.css"
import "../canvas/canvas.css"
import "./board.css"

/**
 * A workspace's board (decision 45): one row for each pinned state, one
 * column for Today and one for each idea. `planBoard` decides from the
 * board's own box how many columns and rows are on screen; a picker holds
 * the rest, with real labels, so no cell is ever out of reach. The board's
 * heights are planBoard's constants, so what is drawn is what the rule counted.
 */
export function Board({ view, actions }: { readonly view: ChromeView; readonly actions: ChromeActions }) {
  const body = useRef<HTMLDivElement>(null)
  const box = useBox(body)
  // The pickers are the UI's own disclosure. They follow the focused idea until you pick another.
  const [paired, setPaired] = useState<string | null>(null)
  const [single, setSingle] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const board = view.workspace
  if (board._tag === "None") return null
  if (board._tag === "Damaged") {
    return <section className="dr-canvas ws-board" data-cal={CAL.board} aria-label="Workspace board">
      <div className="ws-empty" role="alert"><p className="ws-empty__lead">Workspace {board.id} cannot be read.</p><p>{board.reason}</p></div>
    </section>
  }
  const device = view.device
  const trueWidth = device.widthMm * view.pxPerMm
  const frame = { width: trueWidth, height: trueWidth * device.cssHeight / device.cssWidth }
  const { columns, rows } = board
  // Before the first measure the box is zero; after it, a zero height is a real (tiny) board.
  const measured = box.width > 0 || box.height > 0
  const plan = planBoard(measured ? box.width : 900, measured ? box.height : 600, { columns: columns.length, rows: Math.max(1, rows.length) }, frame)
  const ideas = columns.filter(column => column._tag !== "Today")
  const focused = columns.find(column => column._tag === "Idea" && column.focused)
  const pair = ideas.find(column => column.key === paired)?.key ?? focused?.key ?? ideas[0]?.key ?? null
  const one = columns.find(column => column.key === single)?.key ?? focused?.key ?? "today"
  const row = rows.find(item => item.key === picked)?.key ?? rows[0]?.key ?? null
  const shown = plan.columns._tag === "All" ? columns : plan.columns._tag === "Pair" ? columns.filter(column => column._tag === "Today" || column.key === pair) : columns.filter(column => column.key === one)
  const picking = plan.rows._tag === "Pick"
  const shownRows = picking ? rows.filter(item => item.key === row) : rows
  const percent = Math.floor(plan.scale * 100 + 1e-6)
  const cell = { width: frame.width * plan.scale, height: frame.height * plan.scale }
  const geometry: FrameGeometry = { ...cell, scale: cell.width / device.cssWidth, fit: percent < 100 ? { _tag: "Scaled", percent } : { _tag: "TrueSize" } }
  const style = {
    "--ws-cell-w": `${cell.width}px`, "--ws-cell-h": `${cell.height}px`, "--ws-cols": shown.length,
    "--ws-gap": `${GAP}px`, "--ws-head": `${picking ? COMPACT_HEAD : COLUMN_HEAD}px`, "--ws-picker-h": `${PICKER_H}px`,
    "--ws-row-head": `${ROW_HEAD}px`, "--ws-row-pick-w": `${ROW_PICK_W}px`, "--ws-pick-item-h": `${PICK_ITEM_H}px`,
  } as CSSProperties
  const open = board.questions.filter(question => question._tag === "Open").length
  return <section className="dr-canvas ws-board" data-cal={CAL.board} aria-label="Workspace board" data-columns={plan.columns._tag}
    data-rows={plan.rows._tag === "Pick" ? `Pick${plan.rows.place}` : "Stack"} data-status={board.status} style={style}>
    <header className="ws-board__head">
      <div className="ws-board__title">
        <h1>{board.title}</h1>
        <span className="ws-board__status">{board.statusLabel}</span>
        {/* A readout of the question: not while the bar holds it (Ask), nor while the Questions panel shows it whole. */}
        {board.question && board.title !== board.question && board.bar.mode !== "Ask" && view.tools.side !== "record" &&
          <span className="ws-board__question" title={board.question}>“{board.question}”</span>}
      </div>
      <Button small tone="quiet" hook={CAL.questionsOpen} pressed={view.tools.side === "record"} onClick={() => actions.onQuestions(view.tools.side !== "record")}>
        Questions{open > 0 && <span className="ws-count">{open} open</span>}
      </Button>
    </header>
    <div ref={body} className="ws-board__body">
      {rows.length === 0
        ? <div className="ws-empty">
          <p className="ws-empty__lead">{board.status === "Closed" ? "This workspace had no rows." : "Pin the states this question is about."}</p>
          {board.status !== "Closed" && <p>Press the pin beside a state in the parts list. Each pinned state becomes a row. The real files fill the first column, and every idea renders every row.</p>}
        </div>
        : <div className="ws-grid">
          <div className="ws-top">
            {plan.columns._tag !== "All" && <div className="ws-colpick">
              {plan.columns._tag === "Pair" && <span className="ws-colpick__today">Compare with</span>}
              {plan.columns._tag === "Pair"
                ? <BoardPicker label="Idea" value={pair} options={ideas.map(column => ({ id: column.key, label: columnShort(column), title: columnTitle(column) }))} onPick={setPaired} />
                : <BoardPicker label="Column" value={one} options={columns.map(column => ({ id: column.key, label: columnShort(column), title: columnTitle(column) }))} onPick={setSingle} />}
            </div>}
            <div className="ws-heads" role="row">{shown.map(column => <div key={column.key} className="ws-head" role="columnheader" data-focus={column._tag === "Idea" && column.focused || undefined}>
              <BoardColumnName column={column} actions={actions} />
            </div>)}</div>
          </div>
          {picking && <div className="ws-rowpick">
            <BoardPicker label="Row" vertical={plan.rows._tag === "Pick" && plan.rows.place === "Side"} value={row}
              options={rows.map(item => ({ id: item.key, label: item.part, title: `${item.part} · ${item.state}` }))} onPick={setPicked} />
          </div>}
          <div className="ws-rows">{shownRows.map(item => <BoardRow key={item.key} row={item} columns={shown} cells={board.cells} picking={picking} open={board.status !== "Closed"}
            css={{ width: device.cssWidth, height: device.cssHeight }} scale={geometry.scale} fit={percent} actions={actions} />)}</div>
        </div>}
    </div>
    <Caption view={view} actions={actions} geometry={rows.length ? geometry : null} />
  </section>
}
