import { memo, useCallback, useEffect } from "react"
import type { ChromeActions, FrameView } from "../contract"
import type { FrameGeometry } from "../../device-frame.js"
import { CAL } from "../hooks"
import "../tokens.css"
import "./canvas.css"

export type DeviceFrameProps = {
  readonly frame: FrameView
  readonly geometry: FrameGeometry
  /** The device's CSS viewport: what the page inside believes. */
  readonly css: { readonly width: number; readonly height: number }
  readonly actions: ChromeActions
}

function runNote(frame: FrameView): { readonly tone: string; readonly text: string; readonly title?: string } | null {
  if (frame.run?._tag === "Running") return { tone: "running", text: "Working" }
  if (frame.run?._tag === "Failed") return { tone: "bad", text: "Stopped", title: frame.run.reason }
  if (frame.verdict._tag === "Failed") return { tone: "bad", text: "Failed" }
  if (frame.verdict._tag === "Empty") return { tone: "warn", text: "Renders nothing" }
  if (frame.verdict._tag === "Loading") return { tone: "quiet", text: "Loading" }
  return null
}

/**
 * One device frame: the page at the device's CSS viewport, scaled to its
 * physical width. The iframe keeps its node while the frame's key and source
 * stay the same, so a stream update never reloads a page or loses the state
 * you reached in it. Under the frame is its name and a dot only when
 * something happened.
 */
export const DeviceFrame = memo(function DeviceFrame({ frame, geometry, css, actions }: DeviceFrameProps) {
  const { onFrameMount, onFrameGeometry, onTake, onState } = actions
  const mount = useCallback((node: HTMLIFrameElement | null) => onFrameMount(frame.key, node), [onFrameMount, frame.key])
  const { width, height, scale } = geometry
  const fit = geometry.fit._tag === "Scaled" ? geometry.fit.percent : 100
  useEffect(() => {
    if (width > 0) onFrameGeometry(frame.key, { width, height, scale, fit: fit < 100 ? { _tag: "Scaled", percent: fit } : { _tag: "TrueSize" } })
  }, [onFrameGeometry, frame.key, width, height, scale, fit])
  const note = runNote(frame)
  const select = () => frame.take ? onTake(frame.take) : onState(frame.subject)
  return <figure className="dr-frame" data-frame-key={frame.key} data-selected={frame.selected || undefined}
    data-verdict={frame.verdict._tag} data-run={frame.run?._tag} data-take={frame.take ?? undefined}>
    <div className="dr-frame__screen" style={{ width, height }}>
      <iframe ref={mount} className="dr-frame__page" data-cal={CAL.frame} data-frame-key={frame.key} data-part={frame.preview.part} data-state={frame.preview.state}
        data-take={frame.take ?? undefined} title={frame.label} src={frame.src} width={css.width} height={css.height}
        style={{ width: css.width, height: css.height, transform: `scale(${scale})` }} />
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
  </figure>
})
