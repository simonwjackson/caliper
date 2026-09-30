import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import type { Availability, ReferenceOption } from "../contract"
import { CAL } from "../hooks"
import { insertReference, matchReferences, typedName, VISIBLE_REFERENCES } from "../references"
import { ReferenceList } from "./ReferenceList"
import "../tokens.css"
import "../atoms/atoms.css"
import "./marks.css"

export type NoteEditorProps = {
  readonly id: string
  /** The mark's name, take and letter: 6B. */
  readonly name: string
  readonly note: string
  readonly edit: Availability
  readonly onNote: (id: string, note: string) => void
  /** Close the editor. The note is already saved; each change is sent as you type. */
  readonly onClose: () => void
  /** Marks on other takes or the original this note can point to (phase 6). Typing a take number offers them. */
  readonly references?: readonly ReferenceOption[]
  /** Names each of those marks' own notes point to, to set apart in the list. */
  readonly referencesOf?: ReadonlyMap<string, readonly string[]>
}

/** A name the list was closed for, by a pick or Escape: it stays closed until you type on. */
type Dismissed = { readonly start: number; readonly query: string }

/**
 * The note editor (decision 35): a card with the mark's name on a filled tag
 * and one line of text. It opens at the mark you just placed or pressed,
 * and takes focus once per mark, with the caret at the end, so stream
 * updates never steal the caret. Enter or Escape closes it; the note stays.
 *
 * Typing a take number, or 0 for the real files, offers the marks this note
 * can point to whose name starts with what you typed, each with a crop of
 * its place. Arrows move, Enter or Tab picks, Escape closes the list and
 * keeps the note open. Picking writes the name into the note in place of
 * what you typed; the rest of the note does not change.
 */
export function NoteEditor({ id, name, note, edit, onNote, onClose, references = [], referencesOf }: NoteEditorProps) {
  const field = useRef<HTMLInputElement>(null)
  const listId = `dr-refs-${useId().replace(/[^a-z0-9]/gi, "")}`
  const [caret, setCaret] = useState(note.length)
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState<Dismissed | null>(null)
  const [active, setActive] = useState<{ readonly key: string; readonly index: number }>({ key: "", index: 0 })
  /** Where the caret goes once the note with the picked name comes back. */
  const pending = useRef<{ readonly text: string; readonly caret: number } | null>(null)
  useEffect(() => {
    const node = field.current
    if (!node) return
    node.focus({ preventScroll: false })
    node.setSelectionRange(node.value.length, node.value.length)
    setCaret(node.value.length)
    // Into sight now, and again once the canvas has settled round a new frame and the type has loaded.
    const reveal = () => { if (document.activeElement === node) node.scrollIntoView?.({ block: "nearest" }) }
    reveal()
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(reveal) })
    void document.fonts?.ready.then(reveal)
    return () => cancelAnimationFrame(frame)
  }, [id])
  useLayoutEffect(() => {
    const node = field.current, want = pending.current
    if (!node || !want || node.value !== want.text) return
    pending.current = null
    node.setSelectionRange(want.caret, want.caret)
    setCaret(want.caret)
  }, [note])
  const disabled = edit._tag === "Disabled"
  const typed = focused && !disabled && references.length ? typedName(note, Math.min(caret, note.length)) : null
  const matches = typed ? matchReferences(references, typed.query) : []
  const open = typed !== null && matches.length > 0 && !(dismissed && dismissed.start === typed.start && dismissed.query === typed.query)
  const key = typed ? `${typed.start}:${typed.query}` : ""
  const shown = Math.min(matches.length, VISIBLE_REFERENCES)
  const current = active.key === key ? Math.min(active.index, shown - 1) : 0
  const pick = (option: ReferenceOption) => {
    if (!typed) return
    const next = insertReference(note, typed, option.name)
    pending.current = next
    setDismissed({ start: typed.start, query: option.name })
    onNote(id, next.text)
  }
  const follow = () => { const node = field.current; if (node) setCaret(node.selectionStart ?? node.value.length) }
  const combobox = references.length > 0 && !disabled
  return <div className="dr-note" role="group" aria-label={`Note for ${name}`}>
    <span className="dr-note__name">{name}</span>
    <input ref={field} className="dr-note__field" data-cal={CAL.markNote} data-mark-id={id} aria-label={`Note for ${name}`} value={note}
      placeholder="What should change here, or what to keep" readOnly={disabled} aria-readonly={disabled || undefined} title={disabled ? edit.reason : undefined}
      role={combobox ? "combobox" : undefined} aria-autocomplete={combobox ? "list" : undefined} aria-expanded={combobox ? open : undefined}
      aria-controls={open ? listId : undefined} aria-activedescendant={open ? `${listId}-${current}` : undefined}
      onFocus={() => { setFocused(true); follow() }} onBlur={() => setFocused(false)} onSelect={follow}
      onChange={event => { setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length); onNote(id, event.currentTarget.value) }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return
        if (open && typed) {
          const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0
          if (step) { event.preventDefault(); setActive({ key, index: (current + step + shown) % shown }); return }
          if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) {
            event.preventDefault(); event.stopPropagation()
            const option = matches[current]
            if (option) pick(option)
            return
          }
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDismissed({ start: typed.start, query: typed.query }); return }
        } else if (event.key === "ArrowDown" && typed && matches.length) { event.preventDefault(); setDismissed(null); return }
        if (event.key === "Enter" || event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose() }
      }} />
    {open && <ReferenceList id={listId} options={matches} active={current} anchor={field} referencesOf={referencesOf}
      onPick={pick} onActive={index => setActive({ key, index })} />}
    <span className="dr-note__foot">
      <span className="dr-note__hint">{combobox
        ? <>Type <kbd>0</kbd> or a take number to point to a mark. <kbd>Enter</kbd> closes.</>
        : <><kbd>Enter</kbd> closes. Each change is kept as you type.</>}</span>
      <button type="button" className="dr-btn dr-btn--quiet dr-btn--small dr-note__done" data-cal={CAL.markEditorClose} onClick={onClose}>Done</button>
    </span>
  </div>
}
