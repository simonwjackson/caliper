import { useEffect } from "react"
import type { Availability, MarkMode } from "../contract"
import { CAL } from "../hooks"
import { Icon } from "../atoms/Icon"
import "../tokens.css"
import "../atoms/atoms.css"
import "./bar.css"

export type MarkModeButtonProps = {
  readonly mode: MarkMode
  /** Disabled when no frame on the canvas can take a mark. Leaving mark mode is always allowed. */
  readonly availability: Availability
  readonly onMarkMode: (on: boolean) => void
}

/** Keys typed into a field, the editor or a list are text, not commands. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='listbox'], [role='menu']") !== null
}

/**
 * The pin button at the left of the bar (decision 35), filled while mark mode
 * is on. M turns mark mode on and off from anywhere in the chrome that is
 * not a text field; Escape leaves it, and cancels a Re-place.
 */
export function MarkModeButton({ mode, availability, onMarkMode }: MarkModeButtonProps) {
  const on = mode._tag !== "Off"
  const blocked = availability._tag === "Disabled" && !on
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return
      if ((event.key === "m" || event.key === "M") && !event.shiftKey && !event.repeat) {
        if (blocked) return
        event.preventDefault()
        onMarkMode(!on)
      } else if (event.key === "Escape" && on) {
        event.preventDefault()
        onMarkMode(false)
      }
    }
    document.addEventListener("keydown", key)
    return () => document.removeEventListener("keydown", key)
  }, [on, blocked, onMarkMode])
  const title = blocked && availability._tag === "Disabled" ? availability.reason : on ? "Leave mark mode (M)" : "Mark mode (M): click or drag on a take to mark it"
  return <button type="button" className="dr-markbtn" data-cal={CAL.markMode} aria-pressed={on} disabled={blocked}
    aria-label="Mark mode" title={title} onClick={() => onMarkMode(!on)}><Icon name="pin" /></button>
}
