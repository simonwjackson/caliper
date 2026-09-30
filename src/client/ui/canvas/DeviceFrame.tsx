import { memo, useCallback, useEffect } from "react"
import type { ChromeActions, FrameView, MarkupView } from "../contract"
import type { FrameGeometry } from "../../device-frame.js"
import { CAL } from "../hooks"
import { MarkLayer } from "./MarkLayer"
import { MarkSurface } from "./MarkSurface"
import { NoteEditor } from "./NoteEditor"
import "../tokens.css"
import "./canvas.css"
import "./marks.css"

export type DeviceFrameProps = {
  readonly frame: FrameView
  readonly geometry: FrameGeometry
  /** The device's CSS viewport: what the page inside believes. */
  readonly css: { readonly width: number; readonly height: number }
  readonly actions: ChromeActions
  /** Take markup. Omitted, or Unavailable, the frame shows no marks and takes every click. */
  readonly markup?: MarkupView
  /** A chain's parent, the before of its pair: the page is drawn at 78 % so the newer take reads first (decision 35). */
  readonly before?: boolean
  /** Not drawn, but kept mounted, so the page keeps the state reached in it: the other side of a pair that does not fit. */
  readonly hidden?: boolean
}

function runNote(frame: FrameView): { readonly tone: string; readonly text: string; readonly title?: string } | null {
  if (frame.run?._tag === "Running") return { tone: "running", text: "Working" }
  if (frame.run?._tag === "Failed") return { tone: "bad", text: "Stopped", title: frame.run.reason }
  if (frame.verdict._tag === "Failed") return { tone: "bad", text: "Failed" }
  if (frame.verdict._tag === "Empty") return { tone: "warn", text: "Renders nothing" }
  if (frame.verdict._tag === "Loading") return { tone: "quiet", text: "Loading" }
  return null
}

/** After the note editor closes, focus goes back to the mark it was for. */
function refocus(id: string) {
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-cal="${CAL.markPin}"][data-mark-id="${CSS.escape(id)}"]`)?.focus())
}

/**
 * One device frame: the page at the device's CSS viewport, scaled to its
 * physical width. The iframe keeps its node while the frame's key and source
 * stay the same, so a stream update never reloads a page or loses the state
 * you reached in it. Under the frame is its name and a dot only when
 * something happened.
 *
 * Its marks sit over the page. In mark mode a clear layer over a markable
 * frame takes the clicks and drags instead of the page, and the frame gets a
 * dashed edge. The note editor opens under the frame that shows its mark,
 * unless the draft is open, where it opens beside the note.
 */
export const DeviceFrame = memo(function DeviceFrame({ frame, geometry, css, actions, markup, before, hidden }: DeviceFrameProps) {
  const { onFrameMount, onFrameGeometry, onTake, onState, onMarkPoint, onMarkRegion, onMarkEdit, onMarkNote } = actions
  const mount = useCallback((node: HTMLIFrameElement | null) => onFrameMount(frame.key, node), [onFrameMount, frame.key])
  const { width, height, scale } = geometry
  const fit = geometry.fit._tag === "Scaled" ? geometry.fit.percent : 100
  useEffect(() => {
    if (width > 0) onFrameGeometry(frame.key, { width, height, scale, fit: fit < 100 ? { _tag: "Scaled", percent: fit } : { _tag: "TrueSize" } })
  }, [onFrameGeometry, frame.key, width, height, scale, fit])
  const note = runNote(frame)
  const select = () => frame.take ? onTake(frame.take) : onState(frame.subject)
  const ready = markup?._tag === "Ready" ? markup : null
  const marking = !!ready && ready.mode._tag !== "Off" && frame.markable._tag === "Enabled"
  const editor = ready && !ready.draftOpen && ready.editor._tag === "Open" ? ready.editor : null
  const editing = editor && frame.marks.some(mark => mark.id === editor.id) ? editor : null
  const name = frame.take ? `Take ${frame.take}` : frame.label
  return <figure className="dr-frame" data-frame-key={frame.key} data-selected={frame.selected || undefined} data-before={before || undefined} hidden={hidden || undefined}
    data-verdict={frame.verdict._tag} data-run={frame.run?._tag} data-take={frame.take ?? undefined} data-marking={marking || undefined}>
    <div className="dr-frame__mount" style={{ width, height }}>
      <div className="dr-frame__screen" style={{ width, height }}>
        <iframe ref={mount} className="dr-frame__page" data-cal={CAL.frame} data-frame-key={frame.key} data-part={frame.preview.part} data-state={frame.preview.state}
          data-take={frame.take ?? undefined} title={frame.label} src={frame.src} width={css.width} height={css.height}
          style={{ width: css.width, height: css.height, transform: `scale(${scale})` }} />
      </div>
      {marking && <MarkSurface frameKey={frame.key} label={name} css={css} onPoint={onMarkPoint} onRegion={onMarkRegion} />}
      {ready && frame.marks.length > 0 && <MarkLayer marks={frame.marks} scale={scale} css={css} take={frame.take ?? "0"} current={ready.editor._tag === "Open" ? ready.editor.id : null}
        onPick={id => onMarkEdit(id)} />}
    </div>
    {frame.run?._tag === "Running" && <div className="dr-working dr-frame__working" role="progressbar" aria-label={`Take ${frame.take} is working`} />}
    <figcaption className="dr-frame__caption">
      <button type="button" className="dr-frame__name" data-cal={CAL.frameSelect} data-frame-key={frame.key} data-take={frame.take ?? undefined}
        aria-current={frame.selected || undefined} title={frame.title} onClick={select}>
        {frame.take && <b className="dr-frame__take">{frame.take}</b>}<span className={frame.take ? undefined : "dr-frame__real"}>{frame.label}</span>
      </button>
      {note && <span className={`dr-frame__note dr-frame__note--${note.tone}`} title={note.title}>
        <i className={`dr-dot dr-dot--${note.tone === "quiet" ? "" : note.tone}`} aria-hidden="true" />{note.text}
      </span>}
    </figcaption>
    {editing && <NoteEditor id={editing.id} name={editing.name} note={editing.note} edit={editing.edit} onNote={onMarkNote}
      onClose={() => { onMarkEdit(null); refocus(editing.id) }} />}
  </figure>
})
