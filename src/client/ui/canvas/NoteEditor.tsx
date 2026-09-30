import { useEffect, useRef } from "react"
import type { Availability } from "../contract"
import { CAL } from "../hooks"
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
}

/**
 * The note editor (decision 35): a card with the mark's name on a filled tag
 * and one line of text. It opens at the mark you just placed or pressed,
 * and takes focus once per mark, so stream updates never steal the caret.
 * Enter or Escape closes it; the note stays.
 */
export function NoteEditor({ id, name, note, edit, onNote, onClose }: NoteEditorProps) {
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => { field.current?.focus({ preventScroll: false }); field.current?.scrollIntoView?.({ block: "nearest" }) }, [id])
  const disabled = edit._tag === "Disabled"
  return <div className="dr-note" role="group" aria-label={`Note for ${name}`}>
    <span className="dr-note__name">{name}</span>
    <input ref={field} className="dr-note__field" data-cal={CAL.markNote} data-mark-id={id} aria-label={`Note for ${name}`} value={note}
      placeholder="What should change here, or what to keep" readOnly={disabled} aria-readonly={disabled || undefined} title={disabled ? edit.reason : undefined}
      onChange={event => onNote(id, event.currentTarget.value)}
      onKeyDown={event => { if (event.key === "Enter" || event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose() } }} />
    <span className="dr-note__foot">
      <span className="dr-note__hint"><kbd>Enter</kbd> closes. Each change is kept as you type.</span>
      <button type="button" className="dr-btn dr-btn--quiet dr-btn--small dr-note__done" data-cal={CAL.markEditorClose} onClick={onClose}>Done</button>
    </span>
  </div>
}
