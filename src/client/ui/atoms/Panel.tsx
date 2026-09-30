import type { ReactNode } from "react"
import type { CalHook } from "../hooks"
import { Icon } from "./Icon"
import "../tokens.css"
import "./atoms.css"

export type PanelProps = {
  readonly title: ReactNode
  readonly sub?: ReactNode
  /** Controls in the header before the close button, such as Stop. */
  readonly actions?: ReactNode
  readonly onClose?: () => void
  readonly closeLabel?: string
  readonly closeHook?: CalHook
  readonly children: ReactNode
  readonly hook?: CalHook
  readonly take?: string
  readonly label: string
  readonly className?: string
}

/** An opaque card with one edge and no blur. As a sheet it grows a handle; the layout decides which. */
export function Panel({ title, sub, actions, onClose, closeLabel = "Close", closeHook, children, hook, take, label, className }: PanelProps) {
  return <section className={["dr-panel", className ?? ""].filter(Boolean).join(" ")} data-cal={hook} data-take={take} aria-label={label}>
    <div className="dr-panel__handle" aria-hidden="true" />
    <header className="dr-panel__head">
      <h2 className="dr-panel__title">{title}</h2>
      {sub !== undefined && <span className="dr-panel__sub">{sub}</span>}
      {actions}
      {onClose && <button type="button" className="dr-panel__close" data-cal={closeHook} aria-label={closeLabel} title={closeLabel} onClick={() => onClose()}><Icon name="close" /></button>}
    </header>
    <div className="dr-panel__body">{children}</div>
  </section>
}
