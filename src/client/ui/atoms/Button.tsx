import type { ReactNode } from "react"
import type { Availability } from "../contract"
import type { CalHook } from "../hooks"
import "../tokens.css"
import "./atoms.css"

export type ButtonTone = "plain" | "primary" | "quiet" | "link" | "danger"
export type ButtonProps = {
  readonly children: ReactNode
  readonly onClick: () => void
  /** Core's availability. A disabled button shows why in its title and its accessible description. */
  readonly availability?: Availability
  readonly tone?: ButtonTone
  readonly small?: boolean
  readonly hook?: CalHook
  readonly take?: string
  readonly file?: string
  readonly label?: string
  readonly title?: string
  readonly pressed?: boolean
  readonly className?: string
}

/** The one button. Ink for the primary action; no hue. */
export function Button({ children, onClick, availability, tone = "plain", small = false, hook, take, file, label, title, pressed, className }: ButtonProps) {
  const disabled = availability?._tag === "Disabled"
  const reason = availability?._tag === "Disabled" ? availability.reason : undefined
  return <button
    type="button"
    className={["dr-btn", `dr-btn--${tone}`, small ? "dr-btn--small" : "", className ?? ""].filter(Boolean).join(" ")}
    data-cal={hook} data-take={take} data-file={file}
    aria-label={label} aria-pressed={pressed}
    disabled={disabled} title={reason ?? title}
    onClick={() => onClick()}
  >{children}</button>
}
