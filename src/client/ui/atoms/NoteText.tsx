import { noteSegments } from "../references"
import "../tokens.css"
import "./atoms.css"

export type NoteTextProps = {
  /** The text as written. It is never rewritten: joined, the runs are this text. */
  readonly text: string
  /** The mark names to set apart, for example a note's `references` ("use 2A here" gives 2A). */
  readonly names: readonly string[]
}

/**
 * A note, or a line about marks, with the names it points to set apart as
 * small bordered tokens (decision 35: "0A" in a note is a small bordered
 * token). Only the names given are set apart, as whole words, so "v2A" or a
 * name of a mark that is gone stays text.
 */
export function NoteText({ text, names }: NoteTextProps) {
  return <>{noteSegments(text, names).map((segment, index) => segment._tag === "Name"
    ? <span key={index} className="dr-ref">{segment.text}</span>
    : <span key={index}>{segment.text}</span>)}</>
}
