import { useLayoutEffect, useRef } from "react"
import type { RefObject } from "react"
import type { ReferenceOption } from "../contract"
import { CAL } from "../hooks"
import { VISIBLE_REFERENCES } from "../references"
import { NoteText } from "../atoms/NoteText"
import { RefCrop } from "../atoms/RefCrop"
import "../tokens.css"
import "../atoms/atoms.css"
import "./marks.css"

export type ReferenceListProps = {
  /** The listbox's id; option N is `${id}-N`, for the field's active descendant. */
  readonly id: string
  /** The marks that match what is typed, in draft order. The first few are drawn. */
  readonly options: readonly ReferenceOption[]
  /** The option Enter or Tab picks. */
  readonly active: number
  /**
   * The field the list belongs to. With a field the list opens at window
   * level under it, or over it when there is more room above, so no card or
   * scrolling region clips it. Without one it is drawn where it is placed.
   */
  readonly anchor?: RefObject<HTMLElement | null>
  /** Names each option's own note points to, to set apart. */
  readonly referencesOf?: ReadonlyMap<string, readonly string[]>
  readonly onPick: (option: ReferenceOption) => void
  readonly onActive: (index: number) => void
}

/** Room kept between the list and the window's edge, in px. */
const EDGE = 8
/** The list is never narrower than this, in px, unless the window is. */
const LIST_W = 300

/** Whether any of the field shows: inside the window and every region round it that clips. */
function shows(field: HTMLElement): boolean {
  const box = field.getBoundingClientRect()
  let top = Math.max(box.top, 0), bottom = Math.min(box.bottom, innerHeight), left = Math.max(box.left, 0), right = Math.min(box.right, innerWidth)
  for (let at = field.parentElement; at && top < bottom && left < right; at = at.parentElement) {
    const style = getComputedStyle(at)
    if (style.overflowX === "visible" && style.overflowY === "visible") continue
    const clip = at.getBoundingClientRect()
    top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); left = Math.max(left, clip.left); right = Math.min(right, clip.right)
  }
  return top < bottom && left < right
}

/**
 * The type-ahead of the note editor (decision 35): the marks a note can
 * point to that match the name being typed, each with a crop of its place,
 * its name, where it is and its note. The field keeps focus; arrows move the
 * active option, Enter or Tab picks it, Escape closes the list. A press
 * picks too, and does not take focus from the field.
 *
 * At most a few options are drawn, so at most a few crop pages load; the
 * rest are one more letter away, and the list says how many.
 */
export function ReferenceList({ id, options, active, anchor, referencesOf, onPick, onActive }: ReferenceListProps) {
  const list = useRef<HTMLDivElement>(null)
  const shown = options.slice(0, VISIBLE_REFERENCES)
  const more = options.length - shown.length
  const place = () => {
    const node = list.current, field = anchor?.current
    if (!node || !field) return
    // A list whose field has scrolled out of sight would point at nothing: it waits, hidden, until the field shows again.
    node.style.visibility = shows(field) ? "" : "hidden"
    const box = field.getBoundingClientRect()
    const width = Math.min(innerWidth - EDGE * 2, Math.max(box.width, LIST_W))
    node.style.width = `${width}px`
    node.style.left = `${Math.max(EDGE, Math.min(box.left, innerWidth - width - EDGE))}px`
    // Under the field when the list fits there or there is more room there; over it otherwise. It scrolls inside itself.
    const below = innerHeight - box.bottom - EDGE * 2, above = box.top - EDGE * 2
    if (below >= node.scrollHeight || below >= above) {
      node.style.bottom = ""; node.style.top = `${box.bottom + 6}px`; node.style.maxHeight = `${Math.max(below, 0)}px`
    } else {
      node.style.top = ""; node.style.bottom = `${innerHeight - box.top + 6}px`; node.style.maxHeight = `${Math.max(above, 0)}px`
    }
  }
  const placing = useRef(place)
  placing.current = place
  useLayoutEffect(() => {
    const node = list.current
    if (!node || !anchor?.current) return
    if (typeof node.showPopover === "function" && !node.matches(":popover-open")) node.showPopover()
    // The field is where you type: bring it into sight, so the list opens beside it.
    anchor.current.scrollIntoView?.({ block: "nearest", inline: "nearest" })
    // The list's own scrolling moves nothing; the page's and the canvas's move the field.
    const follow = (event: Event) => { if (!(event.target instanceof Node && node.contains(event.target))) placing.current() }
    addEventListener("resize", follow)
    addEventListener("scroll", follow, true)
    return () => {
      removeEventListener("resize", follow)
      removeEventListener("scroll", follow, true)
    }
  }, [anchor])
  // Every render can change the list's height: place it again.
  useLayoutEffect(() => placing.current())
  // The active option stays in view when arrows move it through a list that scrolls.
  useLayoutEffect(() => { list.current?.querySelector(`[aria-selected="true"]`)?.scrollIntoView?.({ block: "nearest" }) }, [active])
  return <div ref={list} id={id} className="dr-refs" role="listbox" aria-label="Marks this note can point to" popover={anchor ? "manual" : undefined}>
    {shown.map((option, index) => <div key={option.id} id={`${id}-${index}`} role="option" aria-selected={index === active} className="dr-refs__option"
      data-cal={CAL.markReference} data-mark-id={option.id} data-picture={option.crop ? undefined : "none"}
      onPointerDown={event => event.preventDefault()} onMouseEnter={() => onActive(index)} onClick={() => onPick(option)}>
      <RefCrop crop={option.crop} name={option.name} />
      <span className="dr-refs__text">
        <span className="dr-refs__head"><b className="dr-refs__name">{option.name}</b><span className="dr-refs__label">{option.label}</span></span>
        <span className="dr-refs__note">{option.note ? <NoteText text={option.note} names={referencesOf?.get(option.id) ?? []} /> : <span className="dr-refs__empty">No note</span>}</span>
      </span>
    </div>)}
    {more > 0 && <p className="dr-refs__more" role="status">{more} more {more === 1 ? "matches" : "match"}. Type more of the name.</p>}
  </div>
}
