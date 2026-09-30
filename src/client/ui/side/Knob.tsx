import { useState } from "react"
import type { ChromeActions, KnobView } from "../contract"
import { CAL } from "../hooks"
import { KnobNumber } from "./KnobNumber"
import { KnobText } from "./KnobText"
import "../tokens.css"
import "./side.css"

function statusText(knob: KnobView): { readonly text: string; readonly tone: string } {
  const write = knob.write
  if (write._tag === "Saving") return { text: "Writing…", tone: "quiet" }
  if (write._tag === "Saved") return { text: `Written to ${knob.source.file.split("/").at(-1)}:${knob.source.line}`, tone: "quiet" }
  if (write._tag === "Conflict") return { text: write.reason, tone: "warn" }
  if (write._tag === "Failed") return { text: write.reason, tone: "bad" }
  return { text: "", tone: "quiet" }
}

/**
 * One knob: show, do not tell. A number with a range is a slider; one
 * without a range has no invented rail and scrubs from its label. A token is
 * the palette of its siblings. Dragging changes the live frames only; release
 * writes the file once; Escape puts the value back without a write
 * (decision 23). Only the live knob, or one with news, shows its source.
 */
export function Knob({ knob, actions }: { readonly knob: KnobView; readonly actions: ChromeActions }) {
  const [live, setLive] = useState(false)
  const control = knob.control
  const disabled = knob.edit._tag === "Disabled"
  const status = statusText(knob)
  const news = status.tone !== "quiet" || knob.problems.length > 0
  return <li className="dr-knob" data-cal={CAL.knob} data-knob={knob.id} data-control={control._tag} data-live={live || undefined} data-news={news || undefined}
    title={disabled && knob.edit._tag === "Disabled" ? knob.edit.reason : knob.note || undefined}
    onFocus={() => setLive(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setLive(false) }}>
    {control._tag === "Number"
      ? <KnobNumber knob={knob} control={control} actions={actions} disabled={disabled} onLive={setLive} />
      : <span className="dr-knob__label"><code>{knob.name.startsWith("--") ? knob.name : knob.label}</code></span>}
    {control._tag === "Color" && <span className="dr-knob__color">
      <input type="color" className="dr-knob__swatch" data-cal={CAL.knobColor} data-knob={knob.id} aria-label={`${knob.label} colour`} disabled={disabled || control.hex === null}
        value={control.hex ?? "#000000"} onInput={event => actions.onKnobInput(knob.id, event.currentTarget.value)} onChange={() => undefined}
        onBlur={event => actions.onKnobCommit(knob.id, event.currentTarget.value)} />
      <KnobText knob={knob} actions={actions} disabled={disabled} />
    </span>}
    {control._tag === "Choice" && <select className="dr-knob__choice" data-cal={CAL.knobChoice} data-knob={knob.id} aria-label={knob.label} disabled={disabled}
      value={knob.value} onChange={event => actions.onKnobCommit(knob.id, event.currentTarget.value)}>
      {control.options.map(option => <option key={option}>{option}</option>)}
    </select>}
    {control._tag === "Token" && <div className={control.color ? "dr-knob__palette" : "dr-knob__tokens"} role="radiogroup" aria-label={knob.label}>
      {control.options.map(option => {
        const chosen = option.name === control.chosen
        return <button key={option.name} type="button" role="radio" aria-checked={chosen} className={control.color ? "dr-knob__chip" : "dr-knob__token"}
          data-cal={CAL.knobToken} data-knob={knob.id} data-token={option.name} disabled={disabled} title={`${option.name}: ${option.value}`}
          aria-label={option.name} style={control.color ? { background: option.value } : undefined} tabIndex={chosen ? 0 : -1}
          onKeyDown={event => {
            const index = control.options.indexOf(option)
            const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? index + 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? index - 1 : null
            if (next === null) return
            event.preventDefault()
            const target = control.options[(next + control.options.length) % control.options.length]
            if (!target) return
            actions.onKnobCommit(knob.id, `var(${target.name})`)
            const group = event.currentTarget.parentElement
            requestAnimationFrame(() => group?.querySelector<HTMLElement>(`[data-token="${CSS.escape(target.name)}"]`)?.focus())
          }}
          onClick={() => actions.onKnobCommit(knob.id, `var(${option.name})`)}>{control.color ? null : option.name}</button>
      })}
    </div>}
    <p className="dr-knob__where">
      {live && <b>Live. </b>}{knob.where} · <button type="button" className="dr-knob__source" data-cal={CAL.sourceFile} data-file={knob.source.file}
        onClick={() => actions.onOpenFile(knob.source.file)}>{knob.source.file}:{knob.source.line}</button>
      {knob.note && <span className="dr-knob__note"> {knob.note}</span>}
    </p>
    {knob.problems.map(problem => <p key={problem} className="dr-knob__problem">{problem}</p>)}
    <p className={`dr-knob__status dr-knob__status--${status.tone}`} data-cal={CAL.knobStatus} role="status">{status.text}</p>
  </li>
}

