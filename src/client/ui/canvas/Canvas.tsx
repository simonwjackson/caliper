import { useLayoutEffect, useRef, useState } from "react"
import type { CSSProperties } from "react"
import type { ChromeActions, ChromeView } from "../contract"
import { frameGeometry } from "../../device-frame.js"
import { CAL } from "../hooks"
import { DeviceFrame } from "./DeviceFrame"
import { PlanSlot } from "./PlanSlot"
import { Caption } from "./Caption"
import { Calibration } from "./Calibration"
import "../tokens.css"
import "./canvas.css"

/** Height the canvas spends on words around one frame: the title, the frame's name and the caption, in rem. */
const WORDS_H = 8.5
type Room = { readonly width: number; readonly height: number; readonly rem: number }

/**
 * The canvas: the real files and each take in one grid, every frame one
 * column and one gap apart (decisions 34 and 35). A plan's directions wait in
 * the slots their takes will fill. Every frame has the same drawn size, true
 * size when one frame and its words fit the canvas, so a comparison is fair.
 * The canvas scrolls inside itself; the page never scrolls.
 */
export function Canvas({ view, actions }: { readonly view: ChromeView; readonly actions: ChromeActions }) {
  const scroll = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState<Room>({ width: 0, height: 0, rem: 16 })
  useLayoutEffect(() => {
    const node = scroll.current
    if (!node) return
    const measure = () => {
      const style = getComputedStyle(node)
      const width = node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const height = node.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      setRoom(previous => previous.width === width && previous.height === height && previous.rem === rem ? previous : { width, height, rem })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const canvas = view.canvas
  const calibrating = view.calibration._tag === "Open"
  const geometry = room.width > 0 ? frameGeometry(view.device, view.pxPerMm, { width: room.width, height: Math.max(0, room.height - WORDS_H * room.rem) }) : null
  const frames = canvas._tag === "Frames" ? canvas.frames : []
  const plan = view.plan
  const label = view.selection._tag === "State" ? view.selection.label : view.selection._tag === "All" ? `All ${frames.length} states` : ""
  const problems = frames.flatMap(frame => frame.problems.map((problem, index) => ({ frame, problem, index })))
  const style = geometry ? { "--dr-col": `${geometry.width}px`, "--dr-row": `${geometry.height}px` } as CSSProperties : undefined
  return <section className="dr-canvas" data-cal={CAL.canvas} data-mode={canvas._tag === "Frames" ? canvas.mode : "Empty"} data-calibrating={calibrating || undefined} aria-label="Canvas">
    <div ref={scroll} className="dr-canvas__scroll">
      {canvas._tag === "Empty"
        ? <p className="dr-canvas__empty">{canvas.message}</p>
        : <div className="dr-canvas__subject" style={style}>
          <header className="dr-canvas__title">
            <h1>{canvas.title}</h1>
            {label && <span className="dr-canvas__label">{label}</span>}
            {plan._tag !== "None" && <q className="dr-canvas__ask">{plan.prompt}</q>}
          </header>
          <div className="dr-frames" data-cal={plan._tag === "None" ? undefined : CAL.plan} aria-label={plan._tag === "None" ? undefined : "Take plan"} role={plan._tag === "None" ? undefined : "group"}>
            {geometry && frames.map(frame => <DeviceFrame key={frame.key} frame={frame} geometry={geometry} css={{ width: view.device.cssWidth, height: view.device.cssHeight }} actions={actions} />)}
            {plan._tag === "Review" && plan.directions.map(({ id, direction }, index) => <PlanSlot key={id} _tag="Direction" id={id} index={index} direction={direction} actions={actions} />)}
            {plan._tag === "Planning" && Array.from({ length: plan.count }, (_, index) => <PlanSlot key={`planning-${index}`} _tag="Planning" index={index} message={plan.message} />)}
          </div>
          {plan._tag === "Review" && plan.note && <p className="dr-canvas__note" role="status">{plan.note}</p>}
          <Caption view={view} actions={actions} geometry={geometry} />
          {problems.length > 0 && <div className="dr-canvas__problems">
            {problems.map(({ frame, problem, index }) => <div key={`${frame.key}:${index}`} className={`dr-problem dr-problem--${problem.kind}`} data-cal={CAL.frameProblem}
              data-frame-key={frame.key} role={problem.kind === "error" ? "alert" : "status"}>
              <b>{problem.title}</b><pre>{problem.detail}</pre>
            </div>)}
          </div>}
        </div>}
    </div>
    <Calibration view={view} actions={actions} />
  </section>
}
