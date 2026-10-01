import { memo, useCallback, useEffect } from "react"
import type { ChromeActions, FrameView } from "../contract"
import { CAL } from "../hooks"
import "../tokens.css"
import "./board.css"

export type BoardFrameProps = {
  readonly frame: FrameView
  /** The device's CSS viewport: what the page inside believes. */
  readonly css: { readonly width: number; readonly height: number }
  /** CSS px of chrome per CSS px of the page. */
  readonly scale: number
  /** The cell's percent of true size, for the caption. */
  readonly fit: number
  readonly actions: Pick<ChromeActions, "onFrameMount" | "onFrameGeometry">
}

/** What the page did, when it is not simply rendered: the cell says it on the screen. */
function verdictNote(frame: FrameView): string | null {
  if (frame.verdict._tag === "Failed") return "Failed to render"
  if (frame.verdict._tag === "Empty") return "Renders nothing"
  return null
}

/**
 * One cell's page: the row's state at the device's CSS viewport, scaled into
 * the cell. The iframe keeps its node while the frame's key and source stay
 * the same, so a stream update never reloads it.
 */
export const BoardFrame = memo(function BoardFrame({ frame, css, scale, fit, actions }: BoardFrameProps) {
  const { onFrameMount, onFrameGeometry } = actions
  const mount = useCallback((node: HTMLIFrameElement | null) => onFrameMount(frame.key, node), [onFrameMount, frame.key])
  const width = css.width * scale
  const height = css.height * scale
  useEffect(() => {
    if (width > 0) onFrameGeometry(frame.key, { width, height, scale, fit: fit < 100 ? { _tag: "Scaled", percent: fit } : { _tag: "TrueSize" } })
  }, [onFrameGeometry, frame.key, width, height, scale, fit])
  const note = verdictNote(frame)
  return <>
    <iframe ref={mount} className="ws-cell__page" data-cal={CAL.frame} data-frame-key={frame.key} data-part={frame.preview.part} data-state={frame.preview.state}
      data-take={frame.take ?? undefined} title={frame.title} src={frame.src} width={css.width} height={css.height}
      style={{ width: css.width, height: css.height, transform: `scale(${scale})` }} />
    {note && <p className="ws-cell__verdict" role="status" title={frame.problems.map(problem => problem.title).join("\n") || undefined}>{note}</p>}
  </>
})
