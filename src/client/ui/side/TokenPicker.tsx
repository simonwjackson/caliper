import { useEffect, useId, useRef, useState } from "react"
import type { KeyboardEvent } from "react"
import type { ChromeActions, KnobView } from "../contract"
import { CAL } from "../hooks"
import { Icon } from "../atoms/Icon"
import "../tokens.css"
import "./side.css"

type TokenControl = Extract<KnobView["control"], { readonly _tag: "Token" }>

/** A token's name without the leading dashes: what you read and type. */
const short = (name: string) => name.replace(/^--/, "")
/** A list longer than this gets a filter field. */
const FILTER_FROM = 8

/**
 * A token knob: one compact field that shows the chosen token, its swatch
 * when it is a colour, and opens the list of its siblings. The list scales:
 * each option is one row with its name and value, it scrolls, and a long
 * list gets a filter. Arrows preview a token in the live frames; Enter or a
 * click writes it once; Escape puts the value back (decision 23).
 *
 * The list is a popover, so no scrolling panel clips it, and it stays in the
 * document while closed, so each option keeps its hook and identity.
 */
export function TokenPicker({ knob, control, actions, disabled }: { readonly knob: KnobView; readonly control: TokenControl; readonly actions: ChromeActions; readonly disabled: boolean }) {
  const panelId = `dr-tokens-${useId().replace(/[^a-z0-9]/gi, "")}`
  const panel = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState("")
  const previewed = useRef(false)
  const chosen = control.options.find(option => option.name === control.chosen)
  const query = filter.trim().toLowerCase()
  const shown = query ? control.options.filter(option => short(option.name).toLowerCase().includes(query) || option.value.toLowerCase().includes(query)) : control.options

  useEffect(() => {
    const node = panel.current
    if (!node) return
    const toggled = (event: Event) => {
      const isOpen = (event as ToggleEvent).newState === "open"
      setOpen(isOpen)
      if (isOpen) return
      setFilter("")
      // Closed without a choice (outside click or Escape): put the previewed value back.
      if (previewed.current) { previewed.current = false; actions.onKnobCancel(knob.id) }
    }
    node.addEventListener("toggle", toggled)
    return () => node.removeEventListener("toggle", toggled)
  }, [actions, knob.id])

  const place = () => {
    const node = panel.current, button = trigger.current
    if (!node || !button) return
    const box = button.getBoundingClientRect()
    const width = Math.max(box.width, 224)
    const below = innerHeight - box.bottom
    node.style.minWidth = `${width}px`
    node.style.left = `${Math.max(8, Math.min(box.left, innerWidth - width - 8))}px`
    if (below < 240 && box.top > below) { node.style.top = ""; node.style.bottom = `${innerHeight - box.top + 4}px` }
    else { node.style.bottom = ""; node.style.top = `${box.bottom + 4}px` }
  }
  const options = () => [...panel.current?.querySelectorAll<HTMLButtonElement>("[role=option]") ?? []]
  const show = () => {
    const node = panel.current
    if (!node?.showPopover || disabled || node.matches(":popover-open")) return
    place()
    node.showPopover()
    requestAnimationFrame(() => (options().find(item => item.getAttribute("aria-selected") === "true") ?? options()[0])?.focus())
  }
  const hide = () => { if (panel.current?.matches(":popover-open")) panel.current.hidePopover(); trigger.current?.focus() }
  const choose = (name: string) => {
    previewed.current = false
    actions.onKnobCommit(knob.id, `var(${name})`)
    hide()
  }
  const move = (event: KeyboardEvent<HTMLElement>) => {
    const items = options()
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === "ArrowDown" ? at + 1 : event.key === "ArrowUp" ? at - 1 : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null
    if (next === null) return
    event.preventDefault()
    const target = items[(next + items.length) % items.length]
    if (!target) return
    target.focus()
    const name = target.dataset.token
    if (name) { previewed.current = true; actions.onKnobInput(knob.id, `var(${name})`) }
  }

  return <div className="dr-token">
    <button ref={trigger} type="button" className="dr-token__trigger" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-controls={panelId}
      aria-label={`${knob.label}: ${chosen ? short(chosen.name) : knob.value}`} title={chosen?.value}
      onClick={() => open ? hide() : show()}
      onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); show() } }}>
      {control.color && <i className="dr-token__swatch" style={{ background: chosen?.value }} aria-hidden="true" />}
      <span className="dr-token__name">{chosen ? short(chosen.name) : knob.value}</span>
      <Icon name="chevron-down" />
    </button>
    <div ref={panel} id={panelId} className="dr-tokens" popover="auto" role="listbox" aria-label={`${knob.label} tokens`}
      onKeyDown={event => {
        if (event.key === "Escape") {
          event.preventDefault()
          if (previewed.current) { previewed.current = false; actions.onKnobCancel(knob.id) }
          hide()
          return
        }
        if (event.target instanceof HTMLInputElement && event.key !== "ArrowDown" && event.key !== "ArrowUp") return
        move(event)
      }}>
      {control.options.length > FILTER_FROM && <input className="dr-tokens__filter" type="search" placeholder="Filter" aria-label={`Filter ${knob.label} tokens`}
        value={filter} onChange={event => setFilter(event.currentTarget.value)} />}
      {shown.map(option => {
        const selected = option.name === control.chosen
        return <button key={option.name} type="button" role="option" aria-selected={selected} className="dr-tokens__option"
          data-cal={CAL.knobToken} data-knob={knob.id} data-token={option.name} disabled={disabled} title={option.value}
          aria-label={short(option.name)} tabIndex={selected ? 0 : -1}
          onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(option.name) } }}
          onClick={() => choose(option.name)}>
          {control.color && <i className="dr-token__swatch" style={{ background: option.value }} aria-hidden="true" />}
          <span className="dr-tokens__name">{short(option.name)}</span>
          <span className="dr-tokens__value">{option.value}</span>
        </button>
      })}
      {shown.length === 0 && <p className="dr-tokens__none">No token matches.</p>}
    </div>
  </div>
}
