import { useRef, useState } from "react"
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react"
import type { ChromeActions, ChromeView, CodeView } from "../contract"
import { CAL } from "../hooks"
import { CODE_SHARE } from "../layout"
import { Button } from "../atoms/Button"
import { Icon } from "../atoms/Icon"
import { Panel } from "../atoms/Panel"
import { FilesMenu } from "./FilesMenu"
import "../tokens.css"
import "./code.css"

type Ready = Extract<CodeView, { _tag: "Ready" }>
const MIN_SHARE = 0.2
const MAX_SHARE = 0.8

function modeLine(code: Ready): string {
  if (code.mode._tag === "Watching") return `Take ${code.take}'s agent is editing. Read only.`
  if (code.mode._tag === "Take") return code.mode.original === null ? `Take ${code.take} adds this file` : `Take ${code.take} against the real files`
  return "Real files"
}
function saveLine(code: Ready): { readonly text: string; readonly tone: string } {
  const save = code.save
  if (save._tag === "Edited") return { text: "Not saved yet", tone: "warn" }
  if (save._tag === "Saving") return { text: "Saving…", tone: "quiet" }
  if (save._tag === "Saved") return { text: save.label, tone: "quiet" }
  if (save._tag === "Failed") return { text: save.reason, tone: "bad" }
  return { text: "", tone: "quiet" }
}

/**
 * The code pane: under the canvas on a desk, a sheet on a phone. Core owns
 * the editor inside the host; this pane owns its place, the tabs, the Files
 * menu, the change steps and the divider. The host keeps its node while the
 * pane moves between places, so the editor keeps its text, selection and scroll.
 */
export function CodePane({ view, actions, place, hidden }: { readonly view: ChromeView; readonly actions: ChromeActions; readonly place: "below" | "sheet"; readonly hidden: boolean }) {
  const code = view.code
  const pane = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  if (code._tag === "Closed") return null
  const share = drag ?? view.tools.codeShare
  const shareFrom = (event: PointerEvent<HTMLDivElement>) => {
    const node = pane.current
    const root = node?.closest<HTMLElement>(".dr-root")
    if (!node || !root) return share
    const height = node.getBoundingClientRect().bottom - event.clientY
    return Math.min(MAX_SHARE, Math.max(MIN_SHARE, height / root.clientHeight))
  }
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowUp" ? 0.05 : event.key === "ArrowDown" ? -0.05 : null
    if (step !== null) { event.preventDefault(); actions.onCodeShare(Math.min(MAX_SHARE, Math.max(MIN_SHARE, Number((share + step).toFixed(2)))), true) }
    else if (event.key === "Home" || event.key === "Enter") { event.preventDefault(); actions.onCodeShare(CODE_SHARE, true) }
  }
  const sub = code._tag === "Ready" ? modeLine(code) : undefined
  const style = drag === null ? undefined : { "--dr-code-h": `${drag * 100}dvh` } as CSSProperties
  return <div ref={pane} className="dr-code" data-place={place} hidden={hidden} style={style}>
    {place === "below" && code._tag === "Ready" && <div className="dr-code__divider" data-cal={CAL.codeShare} role="separator" aria-orientation="horizontal" tabIndex={0}
      aria-label="Code pane height" aria-valuemin={MIN_SHARE * 100} aria-valuemax={MAX_SHARE * 100} aria-valuenow={Math.round(share * 100)}
      title="Drag to resize. Arrows step; Enter or a double click resets."
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setDrag(shareFrom(event)) }}
      onPointerMove={event => { if (drag === null) return; const next = shareFrom(event); setDrag(next); actions.onCodeShare(next, false) }}
      onPointerUp={event => { if (drag === null) return; const next = shareFrom(event); setDrag(null); actions.onCodeShare(next, true) }}
      onPointerCancel={() => { setDrag(null); actions.onCodeShare(view.tools.codeShare, true) }}
      onDoubleClick={() => actions.onCodeShare(CODE_SHARE, true)} onKeyDown={key} />}
    <Panel hook={CAL.code} label="Code" className="dr-code__panel" title="Code" sub={sub}
      actions={code._tag === "Ready" && code.mode._tag === "Watching" && code.take
        ? <Button hook={CAL.stop} take={code.take} availability={code.stop} onClick={() => code.take && actions.onStop(code.take)}><Icon name="stop" />Stop</Button> : undefined}
      onClose={place === "sheet" ? () => actions.onTool("preview") : undefined} closeLabel="Close Code">
      {code._tag === "Loading" && <div className="dr-code__quiet" role="status"><p>{code.message}</p><div className="dr-working" aria-hidden="true" /></div>}
      {code._tag === "Empty" && <p className="dr-code__quiet">{code.message}</p>}
      {code._tag === "Failed" && <div className="dr-code__failed" role="alert"><p>{code.reason}</p><Button hook={CAL.codeRetry} availability={code.retry} onClick={actions.onCodeRetry}>Try again</Button></div>}
      {code._tag === "Ready" && <div className="dr-code__ready">
        <div className="dr-code__tabs">
          <nav className="dr-code__tablist" aria-label="Open files">
            {code.tabs.map(file => {
              const entry = code.files.find(item => item.file === file)
              return <button key={file} type="button" className="dr-code__tab" data-cal={CAL.file} data-file={file} aria-current={file === code.selectedFile || undefined} title={file}
                onClick={() => actions.onOpenFile(file)}>
                {entry?.label ?? file.split("/").at(-1)}
                {entry?.changed && <span className="dr-code__stat"><span className="dr-code__added">+{entry.added ?? 0}</span> <span className="dr-code__removed">−{entry.removed ?? 0}</span></span>}
              </button>
            })}
          </nav>
          <FilesMenu code={code} actions={actions} />
        </div>
        <div className="dr-code__head">
          {code.changes > 0 ? <span>{code.changes} {code.changes === 1 ? "change" : "changes"} in this file</span> : <span className="dr-code__file">{code.selectedFile}</span>}
          {code.lenses.length > 0 && <span className="dr-code__lens" title="The states this file exports">{code.lenses.map(lens => <span key={lens.export} data-current={lens.current || undefined}>{lens.label}</span>)}</span>}
          <span className={`dr-code__status dr-code__status--${saveLine(code).tone}`} data-cal={CAL.codeStatus} role="status">{saveLine(code).text}</span>
          <span className="dr-code__steps">
            {code.changes > 0 && <>
              <button type="button" data-cal={CAL.previousChange} aria-label="Previous change" title="Previous change (Alt+↑)" onClick={() => actions.onPreviousChange()}><Icon name="up" /></button>
              <button type="button" data-cal={CAL.nextChange} aria-label="Next change" title="Next change (Alt+↓)" onClick={() => actions.onNextChange()}><Icon name="down" /></button>
            </>}
            <Button hook={CAL.codeSave} small availability={code.mode._tag === "Watching" ? { _tag: "Disabled", reason: "Read only while the agent works" } : undefined} title="Save (Ctrl+S)" onClick={actions.onCodeSave}>Save</Button>
          </span>
        </div>
        {code.notice && <p className="dr-code__notice" role="status">{code.notice}</p>}
        <div className="dr-code__editor" data-cal={CAL.editor} data-document-key={code.documentKey} data-mode={code.mode._tag} ref={actions.onEditorMount} />
      </div>}
    </Panel>
  </div>
}
