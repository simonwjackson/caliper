import { useLayoutEffect, useRef, useState } from "react"
import type { CSSProperties } from "react"
import type { ChromeActions, ChromeView } from "../contract"
import { frameGeometry } from "../../device-frame.js"
import { CAL } from "../hooks"
import { pairFits } from "../layout"
import { DeviceFrame } from "./DeviceFrame"
import { Chain } from "./Chain"
import { PlanSlot } from "./PlanSlot"
import { Caption } from "./Caption"
import { Calibration } from "./Calibration"
import "../tokens.css"
import "./canvas.css"
import "./chain.css"
import "./marks.css"

/** Height the canvas spends on words around one frame: the title, the frame's name and the caption, in rem. */
const WORDS_H = 8.5
/**
 * The least height a frame is fitted to, in rem. A canvas shorter than its
 * words would scale every frame to nothing, and with it the frame's name, the
 * only way to that take on the canvas. The canvas scrolls instead.
 */
const FRAME_MIN_H = 6
/** The canvas's content box and its gap between frames, in px. */
type Room = { readonly width: number; readonly height: number; readonly rem: number; readonly gap: number }

/**
 * The canvas: the real files and each take in one grid, every frame one
 * column and one gap apart (decisions 34 and 35). A plan's directions wait in
 * the slots their takes will fill. Every frame has the same drawn size, true
 * size when one frame and its words fit the canvas, so a comparison is fair.
 * The canvas scrolls inside itself; the page never scrolls.
 *
 * With takes, the canvas draws the real files and then each chain: its head,
 * its history and its pair (decision 35). When two frames and a gap of the
 * current device do not fit at true size, each chain draws only the frame
 * core names, and its head holds the swap (planner choice 19).
 */
export function Canvas({ view, actions }: { readonly view: ChromeView; readonly actions: ChromeActions }) {
  const scroll = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState<Room>({ width: 0, height: 0, rem: 16, gap: 0 })
  useLayoutEffect(() => {
    const node = scroll.current
    if (!node) return
    const measure = () => {
      const style = getComputedStyle(node)
      const width = node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const height = node.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      const gap = parseFloat(style.getPropertyValue("--dr-gap-now")) || 0
      setRoom(previous => previous.width === width && previous.height === height && previous.rem === rem && previous.gap === gap ? previous : { width, height, rem, gap })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const canvas = view.canvas
  const calibrating = view.calibration._tag === "Open"
  const geometry = room.width > 0 ? frameGeometry(view.device, view.pxPerMm, { width: room.width, height: Math.max(FRAME_MIN_H * room.rem, room.height - WORDS_H * room.rem) }) : null
  const frames = canvas._tag === "Frames" ? canvas.frames : []
  const plan = view.plan
  const label = view.selection._tag === "State" ? view.selection.label : view.selection._tag === "All" ? `All ${frames.length} states` : ""
  const problems = frames.flatMap(frame => frame.problems.map((problem, index) => ({ frame, problem, index })))
  const markup = view.markup._tag === "Ready" ? view.markup : null
  const mode = markup?.mode ?? { _tag: "Off" as const }
  const replacing = mode._tag === "Replacing" ? markup?.groups.flatMap(group => group.marks).find(mark => mark.id === mode.id) : undefined
  const replacingOn = mode._tag === "Replacing" && markup?.groups.some(group => group.source.take === "0" && group.marks.some(mark => mark.id === mode.id)) ? "the real files" : "its take"
  const style = geometry ? { "--dr-col": `${geometry.width}px`, "--dr-row": `${geometry.height}px` } as CSSProperties : undefined
  // Takes as chains: every take frame sits in one chain; the rest (the real files) draw loose, first.
  const chains = canvas._tag === "Frames" && canvas.mode === "Takes" ? canvas.chains : []
  const bands = chains.length > 0
  const byKey = new Map(frames.map(frame => [frame.key, frame]))
  const chained = new Set(chains.flatMap(chain => chain.parent ? [chain.shown, chain.parent] : [chain.shown]))
  const loose = frames.filter(frame => !chained.has(frame.key))
  const pairs = pairFits(view.device.widthMm * view.pxPerMm, room.gap, room.width)
  const css = { width: view.device.cssWidth, height: view.device.cssHeight }
  return <section className="dr-canvas" data-cal={CAL.canvas} data-mode={canvas._tag === "Frames" ? canvas.mode : "Empty"} data-calibrating={calibrating || undefined}
    data-pairs={bands && geometry ? pairs ? "fit" : "solo" : undefined} aria-label="Canvas">
    <div ref={scroll} className="dr-canvas__scroll">
      {canvas._tag === "Empty"
        ? <p className="dr-canvas__empty">{canvas.message}</p>
        : <div className="dr-canvas__subject" style={style}>
          <header className="dr-canvas__title">
            <h1>{canvas.title}</h1>
            {label && <span className="dr-canvas__label">{label}</span>}
            {plan._tag !== "None" && <q className="dr-canvas__ask">{plan.prompt}</q>}
            {mode._tag === "Marking" && <span className="dr-canvas__marking" role="status">Mark mode. Click or drag on a frame. <kbd>M</kbd> leaves.</span>}
            {mode._tag === "Replacing" && <span className="dr-canvas__marking" role="status">Re-place {replacing?.name ?? "the mark"}: click or drag on {replacingOn}. <kbd>Esc</kbd> cancels.</span>}
          </header>
          <div className="dr-frames" data-bands={bands || undefined} data-cal={plan._tag === "None" ? undefined : CAL.plan} aria-label={plan._tag === "None" ? undefined : "Take plan"} role={plan._tag === "None" ? undefined : "group"}>
            {/* A loose frame keeps one wrapper in every mode, so a change of mode never remounts its page. */}
            {geometry && loose.map(frame => <div key={frame.key} className="dr-band"><DeviceFrame frame={frame} geometry={geometry} css={css} actions={actions} markup={view.markup} /></div>)}
            {geometry && chains.map(chain => {
              const shown = byKey.get(chain.shown)
              return shown ? <Chain key={chain.id} chain={chain} shown={shown} parent={chain.parent ? byKey.get(chain.parent) ?? null : null} pairs={pairs}
                geometry={geometry} css={css} actions={actions} markup={view.markup} /> : null
            })}
            {plan._tag === "Review" && plan.directions.map(({ id, direction }, index) => <div key={id} className="dr-band"><PlanSlot _tag="Direction" id={id} index={index} direction={direction} actions={actions} /></div>)}
            {plan._tag === "Planning" && Array.from({ length: plan.count }, (_, index) => <div key={`planning-${index}`} className="dr-band"><PlanSlot _tag="Planning" index={index} message={plan.message} /></div>)}
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
