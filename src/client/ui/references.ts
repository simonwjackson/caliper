/**
 * References in notes (plan decisions 6 to 8, decision 35), as pure
 * functions of text and numbers: which mark name you are typing, which marks
 * it can mean, what the note reads after you pick one, how a note splits so
 * its names can be set apart, and which part of a take's page a crop shows.
 * The Darkroom note editor, the draft and the gates share them.
 */
import type { MarkRect, ReferenceOption } from "./contract"

/** The type-ahead draws at most this many options, so at most this many crop pages load. Typing more narrows the rest. */
export const VISIBLE_REFERENCES = 5

/** A mark name being typed: where it starts and ends in the note, and what is typed so far. */
export type TypedName = { readonly start: number; readonly end: number; readonly query: string }

/** A take number (0 for the original) and up to three letters, at the start of a word, ending at the caret. Not after a point: "0.5" is a number. */
const TYPING = /(?:^|[^\p{L}\p{N}_.])(\d+[A-Za-z]{0,3})$/u
/** Letters and digits after the caret still belong to the word being typed. */
const REST = /^[\p{L}\p{N}_]*/u

/**
 * The mark name typed at the caret, or null. "like 0" and "use 7a" are names
 * being typed; "v2" and "0.5" are not, because a name starts a word, holds
 * only a number and letters, and does not follow a point.
 */
export function typedName(text: string, caret: number): TypedName | null {
  const at = Math.max(0, Math.min(caret, text.length))
  const match = TYPING.exec(text.slice(0, at))
  if (!match?.[1]) return null
  const rest = REST.exec(text.slice(at))?.[0] ?? ""
  // "7A5" or "7AB_" is not a name: the word goes on past the caret with more than letters.
  if (!/^[A-Za-z]*$/.test(rest)) return null
  const query = match[1] + rest
  if (!/^\d+[A-Za-z]{0,3}$/.test(query)) return null
  return { start: at - match[1].length, end: at + rest.length, query }
}

/** The options whose name starts with what is typed, in their order. Letters match in either case. */
export function matchReferences(options: readonly ReferenceOption[], query: string): ReferenceOption[] {
  const typed = query.toUpperCase()
  return options.filter(option => option.name.toUpperCase().startsWith(typed))
}

/**
 * The note after picking `name` for the word being typed, and where the caret
 * goes: after the name and one space. A space is added unless one follows
 * already or punctuation does. Nothing else in the note changes.
 */
export function insertReference(text: string, typed: TypedName, name: string): { readonly text: string; readonly caret: number } {
  const before = text.slice(0, typed.start), after = text.slice(typed.end)
  if (/^\s/.test(after)) return { text: `${before}${name}${after}`, caret: before.length + name.length + 1 }
  if (/^[.,;:!?)\]]/.test(after)) return { text: `${before}${name}${after}`, caret: before.length + name.length }
  return { text: `${before}${name} ${after}`, caret: before.length + name.length + 1 }
}

/** A run of a note: plain text, or a mark name the note points to. */
export type NoteSegment = { readonly _tag: "Text"; readonly text: string } | { readonly _tag: "Name"; readonly text: string }

/**
 * Split a note into text and the names it points to, as whole words, so the
 * names can be set apart. Joining the segments gives the note back unchanged.
 */
export function noteSegments(note: string, names: readonly string[]): NoteSegment[] {
  const known = new Set(names)
  if (!known.size || !note) return note ? [{ _tag: "Text", text: note }] : []
  const segments: NoteSegment[] = []
  let from = 0
  for (const match of note.matchAll(/(?<![\p{L}\p{N}_])\d+[A-Z]{1,3}(?![\p{L}\p{N}_])/gu)) {
    const index = match.index ?? 0
    if (!known.has(match[0])) continue
    if (index > from) segments.push({ _tag: "Text", text: note.slice(from, index) })
    segments.push({ _tag: "Name", text: match[0] })
    from = index + match[0].length
  }
  if (from < note.length) segments.push({ _tag: "Text", text: note.slice(from) })
  return segments
}

/**
 * The part of a page a crop shows. The page is `viewport` CSS px; the crop box
 * is `box` px. The window keeps the box's shape, centres on the mark, holds
 * the mark with room round it, and stays inside the page when the page is
 * larger than the window. A point has no size, so its room is a fifth of the
 * page's width. `scale` is box px per page px; `x` and `y` are the window's
 * top-left in page px; `mark` is the mark in box px.
 */
export type CropView = { readonly scale: number; readonly x: number; readonly y: number; readonly mark: MarkRect }
/** The window is at least this share of the page's width, so a point shows what is round it. */
export const CROP_ROOM = 0.2
/** A region is shown with this much of its size again round it. */
export const CROP_PAD = 0.5

export function cropView(viewport: { readonly width: number; readonly height: number }, rect: MarkRect, box: { readonly width: number; readonly height: number }): CropView {
  const shape = box.width / Math.max(1, box.height)
  const width = Math.max(0, rect.width), height = Math.max(0, rect.height)
  const whole = Math.max(viewport.width, viewport.height * shape)
  const want = Math.max(width * (1 + CROP_PAD), height * (1 + CROP_PAD) * shape, viewport.width * CROP_ROOM, 1)
  const windowW = Math.min(want, whole)
  const windowH = windowW / shape
  const place = (centre: number, size: number, page: number) => size >= page ? (page - size) / 2 : Math.max(0, Math.min(page - size, centre - size / 2))
  const x = place(rect.x + width / 2, windowW, viewport.width)
  const y = place(rect.y + height / 2, windowH, viewport.height)
  const scale = box.width / windowW
  return { scale, x, y, mark: { x: (rect.x - x) * scale, y: (rect.y - y) * scale, width: width * scale, height: height * scale } }
}
