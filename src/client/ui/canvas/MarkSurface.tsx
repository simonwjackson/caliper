import { useRef, useState } from "react"
import type { KeyboardEvent, PointerEvent } from "react"
import type { MarkPoint, MarkRect } from "../contract"
import { CAL } from "../hooks"
import { Icon } from "../atoms/Icon"
import "../tokens.css"
import "../atoms/atoms.css"
import "./marks.css"

export type MarkSurfaceProps = {
  readonly frameKey: string
  /** The frame's name, for the controls' labels: "Take 6". */
  readonly label: string
  /** The device's CSS viewport. Gestures are converted to it, whatever the drawn size. */
  readonly css: { readonly width: number; readonly height: number }
  readonly onPoint: (frameKey: string, point: MarkPoint) => void
  readonly onRegion: (frameKey: string, rect: MarkRect) => void
}

/** A press that moves less than this many drawn px is a click, not a drag. */
const CLICK_PX = 6
type Target = { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value))

/**
 * The clear layer over one frame in mark mode (planner choice 1). A click
 * places a point and a drag places a box, in the device's CSS px. The frame
 * never gets the press, so a menu you opened in it stays open. The page is
 * not read here: core finds the element under the point.
 *
 * From the keyboard, Tab reaches the frame's Point and Area buttons. While
 * one has focus, a target shows on the frame: arrows move it, Shift and
 * arrows size an area, and the buttons place the mark at the target.
 */
export function MarkSurface({ frameKey, label, css, onPoint, onRegion }: MarkSurfaceProps) {
  const surface = useRef<HTMLDivElement>(null)
  const start = useRef<{ readonly pointer: number; readonly screen: MarkPoint; readonly point: MarkPoint } | null>(null)
  const [drag, setDrag] = useState<MarkRect | null>(null)
  const [target, setTarget] = useState<Target>({ x: css.width / 2, y: css.height / 2, width: 0, height: 0 })
  const toCss = (event: PointerEvent<HTMLDivElement>): MarkPoint => {
    const box = event.currentTarget.getBoundingClientRect()
    return { x: clamp((event.clientX - box.left) * css.width / box.width, css.width), y: clamp((event.clientY - box.top) * css.height / box.height, css.height) }
  }
  const between = (from: MarkPoint, to: MarkPoint): MarkRect => ({ x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y) })
  const moved = (event: PointerEvent, from: MarkPoint) => Math.hypot(event.clientX - from.x, event.clientY - from.y) >= CLICK_PX
  const end = () => { start.current = null; setDrag(null) }

  const step = Math.max(4, Math.round(css.width / 32))
  const keys = (event: KeyboardEvent) => {
    const arrows: Record<string, readonly [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const move = arrows[event.key]
    if (!move) return
    event.preventDefault()
    const [dx, dy] = move
    setTarget(now => event.shiftKey
      ? { ...now, width: clamp(now.width + dx * step, css.width - now.x), height: clamp(now.height + dy * step, css.height - now.y) }
      : { ...now, x: clamp(now.x + dx * step, css.width - now.width), y: clamp(now.y + dy * step, css.height - now.height) })
  }
  const sized = target.width > 0 && target.height > 0
  const area = (): MarkRect => sized ? target : {
    x: clamp(target.x - css.width / 8, css.width * 3 / 4), y: clamp(target.y - css.height / 8, css.height * 3 / 4), width: css.width / 4, height: css.height / 4,
  }
  const scale = (value: number, of: number) => `${value / of * 100}%`

  return <div ref={surface} className="dr-surface" data-cal={CAL.markSurface} data-frame-key={frameKey} role="group" aria-label={`Mark ${label}`}
    onPointerDown={event => {
      if (start.current || event.button !== 0 || !event.isPrimary || event.target !== event.currentTarget) return
      start.current = { pointer: event.pointerId, screen: { x: event.clientX, y: event.clientY }, point: toCss(event) }
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
    }}
    onPointerMove={event => {
      const from = start.current
      if (from?.pointer !== event.pointerId) return
      setDrag(moved(event, from.screen) ? between(from.point, toCss(event)) : null)
    }}
    onPointerUp={event => {
      const from = start.current
      if (from?.pointer !== event.pointerId) return
      const to = toCss(event)
      const drawn = moved(event, from.screen)
      end()
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      if (drawn) onRegion(frameKey, between(from.point, to))
      else onPoint(frameKey, to)
    }}
    onPointerCancel={event => { if (start.current?.pointer === event.pointerId) end() }}
    onLostPointerCapture={event => { if (start.current?.pointer === event.pointerId) end() }}>
    {drag && <span className="dr-surface__draft" style={{ left: scale(drag.x, css.width), top: scale(drag.y, css.height), width: scale(drag.width, css.width), height: scale(drag.height, css.height) }} />}
    <span className="dr-surface__target" data-point={sized ? undefined : ""} style={sized
      ? { left: scale(target.x, css.width), top: scale(target.y, css.height), width: scale(target.width, css.width), height: scale(target.height, css.height) }
      : { left: scale(target.x, css.width), top: scale(target.y, css.height) }} />
    <p className="dr-surface__hint">Arrows move the target. Shift and arrows size an area.</p>
    <div className="dr-surface__keys" onKeyDown={keys} onPointerDown={event => event.stopPropagation()}>
      <button type="button" className="dr-btn" data-cal={CAL.markPoint} data-frame-key={frameKey} aria-label={`Place a pin on ${label} at the target`}
        onClick={() => onPoint(frameKey, sized ? { x: target.x + target.width / 2, y: target.y + target.height / 2 } : { x: target.x, y: target.y })}><Icon name="pin" />Pin</button>
      <button type="button" className="dr-btn" data-cal={CAL.markRegion} data-frame-key={frameKey} aria-label={`Mark an area on ${label} at the target`}
        onClick={() => onRegion(frameKey, area())}><Icon name="area" />Area</button>
    </div>
  </div>
}
