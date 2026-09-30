import type { ChromeActions, ChromeView, LogEntry } from "../contract"
import { CAL } from "../hooks"
import { Button } from "../atoms/Button"
import { Flag } from "../atoms/Flag"
import { Icon } from "../atoms/Icon"
import { Panel } from "../atoms/Panel"
import { TakeActions } from "../bar/TakeActions"
import { Integration } from "./Integration"
import { LogLine } from "./LogLine"
import "../tokens.css"
import "./side.css"

function runLabel(run: { readonly _tag: string }): { readonly text: string; readonly tone: string } {
  if (run._tag === "Running") return { text: "Working", tone: "running" }
  if (run._tag === "Failed") return { text: "Stopped", tone: "bad" }
  return { text: "Ready", tone: "good" }
}

const READS = new Set(["read_file", "list_files", "read", "list"])
/**
 * The agent reads before it acts, and one row per file read is noise. A run of
 * finished reads folds into one row that lists them, cut to its width.
 * Edits, renders, failures and reads still running keep their own rows.
 */
export function foldReads(log: readonly LogEntry[]): LogEntry[] {
  const out: LogEntry[] = []
  let run: Extract<LogEntry, { _tag: "Tool" }>[] = []
  const flush = () => {
    if (run.length === 1) out.push(run[0]!)
    else if (run.length > 1) out.push({ _tag: "Tool", name: "read", subject: run.map(entry => entry.subject).join(", "), outcome: "Done", detail: "" })
    run = []
  }
  for (const entry of log) {
    if (entry._tag === "Tool" && READS.has(entry.name) && entry.outcome === "Done") { run.push(entry); continue }
    flush(); out.push(entry)
  }
  flush()
  return out
}

/**
 * A take's record in the side panel: what it is, the brief the planner gave
 * its agent (folded; it is written for the agent), the files it changes, its conversation, and what you can do with it. While the agent
 * works, Stop sits in the header, where the eye lands first, and the log
 * grows at the foot. The record also carries Accept and Discard, because on a
 * phone it covers the bar that holds them.
 *
 * Under the facts: where the take came from, as the chain's head says it, and
 * the accept flag with its reason written out, since the canvas folds it.
 * What Accept also removes is said only in core's confirmation (choice 20).
 */
export function TakeRecord({ view, actions, sheet }: { readonly view: ChromeView; readonly actions: ChromeActions; readonly sheet: boolean }) {
  if (view.record._tag === "Closed") return null
  const { take, log, integration, emptyLogMessage } = view.record
  const run = runLabel(take.run)
  const running = take.run._tag === "Running"
  return <Panel hook={CAL.record} take={take.id} label={`Take ${take.id} record`} className="dr-record" title={`Take ${take.id}`} sub={take.name}
    onClose={actions.onRecordClose} closeLabel="Close the record" closeHook={CAL.recordClose}
    actions={running ? <Button hook={CAL.stop} take={take.id} availability={take.stop} onClick={() => actions.onStop(take.id)}><Icon name="stop" />Stop</Button> : undefined}>
    <div className="dr-record__body" data-sheet={sheet || undefined}>
      <p className="dr-record__facts">
        <span className={`dr-record__run dr-record__run--${run.tone}`}><i className={`dr-dot dr-dot--${run.tone}`} aria-hidden="true" />{run.text}</span>
        <span>{take.files.length} {take.files.length === 1 ? "file" : "files"}</span>
        <span>{take.subjectLabel}</span><span>{take.deviceLabel}</span>
        {take.kind === "Alternate" && <span>Alternate</span>}
      </p>
      {take.lineage && <p className="dr-record__lineage"><span className="dr-sr">Chain: </span>{take.lineage}</p>}
      <Flag flag={take.flag} variant="Full" />
      {running && <div className="dr-working" role="progressbar" aria-label={`Take ${take.id} is working`} />}
      {take.run._tag === "Failed" && <p className="dr-record__failed" role="alert">{take.run.reason}</p>}
      {take.unavailableReason && <p className="dr-record__warn" role="status">{take.unavailableReason}</p>}
      {take.nameIssue && <p className="dr-record__warn">{take.nameIssue}</p>}
      {take.direction && <details className="dr-record__direction"><summary>Brief{take.direction.strange ? " · strange" : ""}<i className="dr-chev" aria-hidden="true" /></summary>
        <p>{take.direction.title === take.name ? "" : `${take.direction.title}: `}{take.direction.brief}</p></details>}
      {take.createdLabel && <p className="dr-record__context">{take.createdLabel}</p>}
      {take.files.length > 0 && <ul className="dr-record__files" aria-label="Changed files">
        {take.files.map(file => <li key={file}><button type="button" className="dr-record__file" data-cal={CAL.file} data-file={file} title="Open in Code" onClick={() => actions.onOpenFile(file)}>{file}</button></li>)}
      </ul>}
      <ol className="dr-log" data-cal={CAL.log} aria-live="polite" aria-label="Conversation">
        {log.length === 0 && <li className="dr-log__empty">{emptyLogMessage}</li>}
        {foldReads(log).map((entry, index) => <LogLine key={index} entry={entry} />)}
      </ol>
      <div className="dr-record__foot">
        <TakeActions take={take} actions={actions} named={false} />
        {take.kind === "Experiment" && <Button hook={CAL.alternate} take={take.id} availability={take.prepareAlternate} onClick={() => actions.onPrepareAlternate(take.id)}>Add an alternate</Button>}
      </div>
      <Integration take={take.id} view={integration} actions={actions} />
    </div>
  </Panel>
}

