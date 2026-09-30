import { useEffect, useRef } from "react"
import type { ChromeActions, ChromeView } from "../contract"
import { CAL } from "../hooks"
import { Button } from "../atoms/Button"
import { Icon } from "../atoms/Icon"
import { Notices } from "../atoms/Notices"
import { CheckRow } from "./CheckRow"
import "../tokens.css"
import "./checks.css"

const PASSING = new Set(["Passed", "Accepted"])

/**
 * The Checks window over the room. One total line; failures and anything
 * that needs you first, each with its reason; every pass folded into one
 * line. Closing the window does not stop a run; Stop is its own button.
 */
export function ChecksWindow({ view, actions }: { readonly view: ChromeView; readonly actions: ChromeActions }) {
  const checks = view.checks
  const dialog = useRef<HTMLDialogElement>(null)
  const open = checks._tag === "Open"
  useEffect(() => {
    const node = dialog.current
    if (!node || !open) return
    if (!node.open) node.showModal()
    return () => { if (node.open) node.close() }
  }, [open])
  if (checks._tag === "Closed") return null
  const run = checks.run
  const rows = run._tag === "Ready" ? run.rows : []
  const attention = rows.filter(row => !PASSING.has(row.badge.status))
  const passed = rows.filter(row => PASSING.has(row.badge.status))
  return <dialog ref={dialog} className="dr-checks" data-cal={CAL.checks} aria-label="Checks" onCancel={event => { event.preventDefault(); actions.onChecksClose() }}>
    <header className="dr-checks__head">
      <h2>Checks</h2><span className="dr-checks__target">{checks.targetLabel}</span>
      <button type="button" className="dr-checks__close" data-cal={CAL.checksClose} onClick={() => actions.onChecksClose()}>Close</button>
    </header>
    <div className="dr-checks__body">
      <div className="dr-checks__sum">
        {run._tag === "Ready" ? <><b>{run.badge.label}</b><span>{run.summary}</span></>
          : run._tag === "Running" ? <><b>Running</b><span role="status">{run.progress}</span></>
          : run._tag === "Loading" ? <span role="status">Loading the last results…</span>
          : run._tag === "Idle" ? <span>No checks have run for this part yet.</span>
          : <span className="dr-checks__bad" role="alert">{run._tag === "Cancelled" ? "Stopped. " : ""}{run.reason}</span>}
        <span className="dr-checks__run">
          {run._tag === "Running"
            ? <Button hook={CAL.checkStop} availability={run.stop} onClick={() => actions.onCheckStop(run.id)}><Icon name="stop" />Stop checks</Button>
            : <>
              <Button hook={CAL.checkRun} availability={checks.runSelected} onClick={() => actions.onCheckRun("selected")}>{run._tag === "Ready" ? "Run again" : "Check this state"}</Button>
              <Button hook={CAL.checkRun} availability={checks.runAll} onClick={() => actions.onCheckRun("all")}>Check all states</Button>
            </>}
        </span>
      </div>
      {run._tag === "Running" && <div className="dr-working dr-checks__working" aria-hidden="true" />}
      <Notices notices={checks.notices} />
      {run._tag === "Ready" && <>
        {run.stale && <p className="dr-checks__stale" role="status">These results are out of date: the source changed after this run.</p>}
        {attention.map(row => <CheckRow key={row.index} run={run.id} row={row} actions={actions} open={row.badge.status === "Failed"} />)}
        {passed.length > 0 && <details className="dr-checks__passed">
          <summary><span className="dr-check__glyph dr-check__glyph--ok" aria-hidden="true">✓</span><span>{passed.length} passed</span><i className="dr-chev" aria-hidden="true" /></summary>
          {passed.map(row => <CheckRow key={row.index} run={run.id} row={row} actions={actions} open={false} />)}
        </details>}
        <details className="dr-checks__coverage">
          <summary>What these checks cover<i className="dr-chev" aria-hidden="true" /></summary>
          <p>{run.coverage}</p><p className="dr-checks__detail">{run.runDetail}</p>
        </details>
        <a className="dr-checks__report" data-cal={CAL.report} href={run.reportUrl} download="caliper-checks.json">Download the report</a>
      </>}
    </div>
  </dialog>
}
