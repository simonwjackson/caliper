import { useRef, useState } from "react"
import type { KeyboardEvent, PointerEvent } from "react"
import type { ChromeActions, KnobControl, KnobView } from "../contract"
import { clampTo, formatNumber, parseNumber, scrub } from "../../knob-values.js"
import { CAL } from "../hooks"
import "../tokens.css"
import "./side.css"

type NumberControl = Extract<KnobControl, { _tag: "Number" }>
const STEP_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"])

/**
 * A number knob: its name is a scrub handle, a slider when the source gives a
 * range (never an invented one), and the typed value. Dragging and typing
 * change the live frames; release, Enter or leaving writes once; Escape puts
 * the value back without a write (decision 23).
 */
export function KnobNumber({ knob, control, actions, disabled, onLive }: {
  readonly knob: KnobView; readonly control: NumberControl; readonly actions: ChromeActions; readonly disabled: boolean; readonly onLive: (live: boolean) => void
}) {
  const current = parseNumber(knob.value)?.number ?? control.number
  const format = (number: number) => formatNumber(clampTo(control, number), control.unit, control.step)
  const drag = useRef<{ x: number; start: number; last: string } | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const bounded = control.min !== undefined && control.max !== undefined
  const scrubStart = (event: PointerEvent<HTMLSpanElement>) => {
    if (disabled || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, start: current, last: knob.value }
    onLive(true)
  }
  const scrubMove = (event: PointerEvent<HTMLSpanElement>) => {
    const state = drag.current
    if (!state) return
    const value = format(scrub({ ...control, number: state.start }, event.clientX - state.x))
    if (value !== state.last) { state.last = value; actions.onKnobInput(knob.id, value) }
  }
  const scrubEnd = () => {
    const state = drag.current
    drag.current = null
    onLive(false)
    if (state) actions.onKnobCommit(knob.id, state.last)
  }
  const scrubCancel = () => { if (drag.current) { drag.current = null; onLive(false); actions.onKnobCancel(knob.id) } }
  const commitText = (text: string) => {
    setDraft(null)
    const parsed = parseNumber(text)
    if (parsed) actions.onKnobCommit(knob.id, format(parsed.number))
  }
  const shown = draft ?? String(current)
  return <>
    <span className="dr-knob__label dr-knob__label--scrub" title={disabled ? undefined : "Drag sideways to change"}
      onPointerDown={scrubStart} onPointerMove={scrubMove} onPointerUp={scrubEnd} onPointerCancel={scrubCancel}>
      <code>{knob.name.startsWith("--") ? knob.name : knob.label}</code>{knob.name.startsWith("--") && <span className="dr-sr">, {knob.label}</span>}
    </span>
    {bounded ? <input type="range" className="dr-knob__slider" data-cal={CAL.knobSlider} data-knob={knob.id} aria-label={`${knob.label} slider`} disabled={disabled}
      min={control.min} max={control.max} step={control.step} value={current}
      onChange={event => actions.onKnobInput(knob.id, format(Number(event.currentTarget.value)))}
      onPointerUp={event => actions.onKnobCommit(knob.id, format(Number(event.currentTarget.value)))}
      onPointerCancel={() => actions.onKnobCancel(knob.id)}
      onKeyUp={(event: KeyboardEvent<HTMLInputElement>) => { if (STEP_KEYS.has(event.key)) actions.onKnobCommit(knob.id, format(Number(event.currentTarget.value))) }}
      onKeyDown={event => { if (event.key === "Escape") actions.onKnobCancel(knob.id) }} />
      : <span className="dr-knob__free" aria-hidden="true" />}
    <span className="dr-knob__value">
      {/* A text field, so a unit can be typed, that reads as a number field: arrows step it. */}
      <input type="text" inputMode="decimal" role="spinbutton" aria-valuenow={current} aria-valuetext={knob.value}
        aria-valuemin={control.min} aria-valuemax={control.max}
        data-cal={CAL.knobValue} data-knob={knob.id} aria-label={knob.label} disabled={disabled} value={shown}
        size={Math.max(2, shown.length)} spellCheck={false}
        onChange={event => { const text = event.currentTarget.value; setDraft(text); const parsed = parseNumber(text); if (parsed) actions.onKnobInput(knob.id, format(parsed.number)) }}
        onKeyDown={event => {
          if (event.key === "Enter") { event.preventDefault(); commitText(event.currentTarget.value) }
          else if (event.key === "Escape") { event.preventDefault(); setDraft(null); actions.onKnobCancel(knob.id) }
          else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault()
            setDraft(null)
            actions.onKnobInput(knob.id, format(current + (event.key === "ArrowUp" ? control.step : -control.step) * (event.shiftKey ? 10 : 1)))
          }
        }}
        onKeyUp={event => { if (event.key === "ArrowUp" || event.key === "ArrowDown") actions.onKnobCommit(knob.id, knob.value) }}
        onBlur={event => { if (draft !== null) commitText(event.currentTarget.value) }} />
      {control.unit && <span className="dr-knob__unit">{control.unit}</span>}
    </span>
  </>
}
