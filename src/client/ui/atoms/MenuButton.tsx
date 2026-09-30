import { useEffect, useId, useRef, useState } from "react"
import type { CSSProperties, ReactNode } from "react"
import "../tokens.css"
import "./atoms.css"

export type MenuButtonProps = {
  /** The trigger's accessible name. */
  readonly label: string
  readonly trigger: ReactNode
  readonly triggerClass: string
  readonly menuClass?: string
  readonly pressed?: boolean
  readonly title?: string
  /** Above the button, aligned to its end (the bar, the dock); or beside it (the rail). */
  readonly placement?: "above" | "beside"
  readonly children: ReactNode
}

const EDGE = 8
/**
 * Where the open menu goes, in viewport pixels. The menu is fixed, so no
 * scrolling or clipping region of the chrome can cut it off (intrinsic rule 8).
 */
function placeMenu(button: HTMLElement, placement: "above" | "beside"): CSSProperties {
  const rect = button.getBoundingClientRect()
  if (placement === "beside") return { left: rect.right + EDGE, bottom: Math.max(EDGE, innerHeight - rect.bottom), maxHeight: innerHeight - 2 * EDGE }
  return { right: Math.max(EDGE, innerWidth - rect.right), bottom: innerHeight - rect.top + EDGE, maxHeight: Math.max(120, rect.top - 2 * EDGE), maxWidth: innerWidth - 2 * EDGE }
}

const ITEMS = "[role=menuitem]:not(:disabled), [role=menuitemradio]:not(:disabled)"

/**
 * A button that opens a menu at window level above it. Opening focuses the
 * checked item or the first; arrows, Home and End move; Escape closes and
 * returns focus to the button; Tab or a click elsewhere closes. Choosing an
 * item closes the menu, except an item marked `data-keep-open` that unfolds
 * more of the menu. The UI owns this disclosure; the app never hears of it.
 */
export function MenuButton({ label, trigger, triggerClass, menuClass, pressed, title, placement = "above", children }: MenuButtonProps) {
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<CSSProperties>({})
  const menu = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    const node = menu.current
    const first = node?.querySelector<HTMLElement>("[aria-checked=true]:not(:disabled)") ?? node?.querySelector<HTMLElement>(ITEMS)
    first?.focus()
    const away = (event: PointerEvent) => {
      if (!node?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false)
    }
    const resize = () => setOpen(false)
    addEventListener("pointerdown", away)
    addEventListener("resize", resize)
    return () => { removeEventListener("pointerdown", away); removeEventListener("resize", resize) }
  }, [open])
  const toggle = (next: boolean) => {
    if (next && button.current) setStyle(placeMenu(button.current, placement))
    setOpen(next)
  }
  const close = (refocus: boolean) => { setOpen(false); if (refocus) button.current?.focus() }
  return <span className="dr-menu-button">
    <button ref={button} type="button" className={triggerClass} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      aria-label={label} aria-pressed={pressed} title={title ?? label} onClick={() => toggle(!open)}
      onKeyDown={event => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); toggle(true) } }}>
      {trigger}
    </button>
    {open && <div ref={menu} id={id} className={["dr-menu", menuClass ?? ""].join(" ")} role="menu" aria-label={label} style={style}
      onClick={event => { const item = (event.target as HTMLElement).closest(ITEMS); if (item && !item.hasAttribute("data-keep-open")) close(true) }}
      onKeyDown={event => {
        const items = [...(menu.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])]
        const at = items.indexOf(document.activeElement as HTMLElement)
        const move = (index: number) => { event.preventDefault(); items[(index + items.length) % items.length]?.focus() }
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true) }
        else if (event.key === "ArrowDown") move(at + 1)
        else if (event.key === "ArrowUp") move(at - 1)
        else if (event.key === "Home") move(0)
        else if (event.key === "End") move(items.length - 1)
        else if (event.key === "Tab") close(false)
      }}>{children}</div>}
  </span>
}
