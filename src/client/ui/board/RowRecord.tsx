import type { ChromeActions, ChromeView } from "../contract"
import { CAL } from "../hooks"
import { Button } from "../atoms/Button"
import { Icon } from "../atoms/Icon"
import { Panel } from "../atoms/Panel"
import { LogLine } from "../side/LogLine"
import { foldReads } from "../side/TakeRecord"
import { RowCheck } from "./RowCheck"
import "../tokens.css"
import "../side/side.css"
import "./board.css"

/**
 * A row's record, where the questions sit (workspaces slice 2): what you
 * asked its agent, its file, its checks in one column at a time, and the
 * agent's log. The count comes first and each check follows with one line,
 * as a test report reads. A column's sign says whether every check passed
 * there, so the other columns are one press away. A pinned state's record
 * has its checks only.
 */
export function RowRecord({ view, actions, sheet }: { readonly view: ChromeView; readonly actions: ChromeActions; readonly sheet: boolean }) {
  const board = view.workspace
  if (board._tag !== "Open" || board.record._tag !== "Open") return null
  const record = board.record
  const scratch = record.scratch
  const running = scratch?.run._tag === "Running"
  const total = record.checks.length
  const passedIn = (column: string) => record.checks.filter(check => check.results.some(item => item.column === column && item.status === "Passed")).length
  const doneIn = (column: string) => record.checks.every(check => check.results.some(item => item.column === column && ["Passed", "Failed", "Inconclusive"].includes(item.status)))
  const shown = record.columns.find(column => column.key === record.column) ?? record.columns[0]
  return <Panel hook={CAL.rowRecord} label={`${record.title} record`} className="dr-record" title={record.title}
    sub={`${scratch ? "Scratch" : "Pinned"} · ${total === 1 ? "1 check" : `${total} checks`}`}
    onClose={() => actions.onRowRecord(null)} closeLabel="Close the row's record"
    actions={running && scratch ? <Button hook={CAL.stop} availability={scratch.stop} onClick={() => actions.onRowStop(scratch.id)}><Icon name="stop" />Stop</Button> : undefined}>
    <div className="dr-record__body ws-rec" data-sheet={sheet || undefined}>
      <p className="dr-record__facts">
        {scratch && <span className={`dr-record__run dr-record__run--${running ? "running" : scratch.run._tag === "Failed" ? "bad" : "good"}`}>
          <i className={`dr-dot dr-dot--${running ? "running" : scratch.run._tag === "Failed" ? "bad" : "good"}`} aria-hidden="true" />{running ? "Writing" : scratch.run._tag === "Failed" ? "Stopped" : "Ready"}</span>}
        <code className="ws-rec__file" title={record.file}>{record.file}</code>
      </p>
      {running && <div className="dr-working" role="progressbar" aria-label={`${record.title} is being written`} />}
      {scratch?.run._tag === "Failed" && <p className="dr-record__failed" role="alert">{scratch.run.reason}</p>}
      {record.brief && <p className="ws-q__text ws-rec__brief">{record.brief}</p>}
      <section className="ws-rec__checks" aria-label="Checks">
        <header className="ws-rec__head">
          <h3 className="ws-q__head">Checks</h3>
          <Button small tone="quiet" hook={CAL.rowCheck} availability={record.checkAgain} onClick={() => actions.onRowCheck(record.row)}>Check again</Button>
        </header>
        {total === 0 ? <p className="ws-q__none">{running ? "The agent has not written a check yet." : "This row declares no checks."}</p> : <>
          <div className="ws-picker ws-rec__columns" role="group" aria-label="Column">
            {record.columns.map(column => {
              const done = doneIn(column.key)
              const all = passedIn(column.key) === total
              // A count, not a sign: a cross beside a label reads as a button that removes it.
              return <button key={column.key} type="button" className="ws-picker__item ws-rec__column" aria-pressed={column.key === shown?.key}
                data-tone={!done ? "quiet" : all ? "good" : "bad"} onClick={() => actions.onRowRecord(record.row, column.key)}>
                {column.label}<span className="ws-rec__tally" aria-label={done ? `${passedIn(column.key)} of ${total} pass` : "not checked yet"}>{done ? `${passedIn(column.key)}/${total}` : "…"}</span>
              </button>
            })}
          </div>
          {shown && <p className="ws-rec__count">{doneIn(shown.key) ? `${passedIn(shown.key)} of ${total} ${total === 1 ? "check passes" : "checks pass"} in ${shown.label}.` : `${shown.label} is not checked yet.`}</p>}
          <ul className="ws-rec__list">{record.checks.map(check => <RowCheck key={check.name} check={check} column={shown?.key ?? ""} file={record.file} />)}</ul>
        </>}
      </section>
      {scratch && <section aria-label="The row agent">
        <h3 className="ws-q__head">Row agent</h3>
        <ol className="dr-log" data-cal={CAL.log} aria-live="polite" aria-label="Conversation">
          {record.log.length === 0 && <li className="dr-log__empty">No conversation yet.</li>}
          {foldReads(record.log).map((entry, index) => <LogLine key={index} entry={entry} />)}
        </ol>
      </section>}
      {scratch && board.status !== "Closed" && <footer className="ws-q__foot">
        <Button tone="danger" small hook={CAL.rowDelete} availability={scratch.remove} onClick={() => actions.onRowDelete(scratch.id)}>Delete row</Button>
        <span>Its file and its place on the board go. The ideas keep their files.</span>
      </footer>}
    </div>
  </Panel>
}
