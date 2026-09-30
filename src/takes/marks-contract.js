// @ts-check
import { Type } from "typebox"
import { StateRefSchema } from "../scenario-contract.js"

/**
 * Browser-safe schemas for the draft of marks. The dev server stores the
 * draft in `.caliper/marks.json`; the chrome validates what it receives.
 *
 * Every rect is in the frame's CSS px from the document origin, not the
 * viewport, so a scrolled frame still finds the mark.
 */

const text = (maxLength = 1024) => Type.String({ maxLength })
const size = Type.Number({ minimum: 0, maximum: 100_000 })
const place = Type.Number({ minimum: -100_000, maximum: 100_000 })

export const MAX_MARKS = 200
export const MAX_NOTE = 2000
/** The most elements a region records. */
export const MAX_REGION_ELEMENTS = 12

export const MarkRectSchema = Type.Object({ x: place, y: place, width: size, height: size }, { additionalProperties: false })
export const TakeIdentitySchema = Type.Object({
  take: Type.String({ pattern: "^[1-9][0-9]*$" }),
  created: Type.Number({ minimum: 0, maximum: 8.64e15 }),
}, { additionalProperties: false })

/**
 * Where a mark was placed: a take, or the original (the real files) as
 * `{ take: "0", created: 0 }`, so its marks are named "0A" (plan decision 8).
 */
export const MarkSourceSchema = Type.Union([
  TakeIdentitySchema,
  Type.Object({ take: Type.Literal("0"), created: Type.Literal(0) }, { additionalProperties: false }),
])

/** One element as the agent reads it. `box` is where it was when the mark was placed. */
export const MarkElementSchema = Type.Object({
  selector: Type.String({ minLength: 1, maxLength: 2000 }),
  tag: Type.String({ minLength: 1, maxLength: 100 }),
  classes: Type.Array(Type.String({ maxLength: 200 }), { maxItems: 20 }),
  /** The first 80 characters of its text, with white space collapsed. */
  text: Type.String({ maxLength: 80 }),
  box: MarkRectSchema,
}, { additionalProperties: false })

/**
 * Where a mark is. A point keeps the click; a region keeps the dragged rect.
 * `element` is the element under a point, or the smallest element that holds
 * the whole region. `afterInput`: the frame had pointer or key input since it
 * last loaded, so a fresh render may not show what was marked.
 */
export const MarkAnchorSchema = Type.Object({
  kind: Type.Union([Type.Literal("Point"), Type.Literal("Region")]),
  rect: MarkRectSchema,
  element: MarkElementSchema,
  elements: Type.Array(MarkElementSchema, { maxItems: MAX_REGION_ELEMENTS }),
  afterInput: Type.Boolean(),
}, { additionalProperties: false })

export const MarkSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 100 }),
  source: MarkSourceSchema,
  preview: StateRefSchema,
  /** Only on the original: the editing subject a take made from this mark edits. A take's subject is in its record. */
  subject: Type.Optional(StateRefSchema),
  device: Type.String({ minLength: 1, maxLength: 100 }),
  /** A to Z, then AA, AB and so on. Unique per take identity in the draft. */
  letter: Type.String({ pattern: "^[A-Z]{1,3}$" }),
  note: text(MAX_NOTE),
  anchor: MarkAnchorSchema,
}, { additionalProperties: false })

export const DraftSchema = Type.Object({
  revision: Type.Integer({ minimum: 0 }),
  marks: Type.Array(MarkSchema, { maxItems: MAX_MARKS }),
}, { additionalProperties: false })

/** What the chrome sends to add a mark. The server picks its id and letter. */
export const NewMarkSchema = Type.Object({
  revision: Type.Integer({ minimum: 0 }),
  source: MarkSourceSchema,
  preview: StateRefSchema,
  subject: Type.Optional(StateRefSchema),
  device: Type.String({ minLength: 1, maxLength: 100 }),
  anchor: MarkAnchorSchema,
}, { additionalProperties: false })

/** A note edit, a re-place, or both. */
export const MarkChangeSchema = Type.Object({
  revision: Type.Integer({ minimum: 0 }),
  note: Type.Optional(text(MAX_NOTE)),
  anchor: Type.Optional(MarkAnchorSchema),
}, { additionalProperties: false })

export const RevisionSchema = Type.Object({ revision: Type.Integer({ minimum: 0 }) }, { additionalProperties: false })

/** Marks on the original that went with a prompt and now leave the draft (planner choice 14). */
export const ReleaseSchema = Type.Object({
  revision: Type.Integer({ minimum: 0 }),
  ids: Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { minItems: 1, maxItems: MAX_MARKS }),
}, { additionalProperties: false })

export const DraftResponseSchema = Type.Object({ draft: DraftSchema })
export const AddedMarkSchema = Type.Object({ id: Type.String(), draft: DraftSchema })
export const SentSchema = Type.Object({ takes: Type.Array(Type.String()), draft: DraftSchema })

/**
 * @typedef {import("typebox").Static<typeof MarkRectSchema>} StoredRect
 * @typedef {import("typebox").Static<typeof MarkElementSchema>} MarkElement
 * @typedef {import("typebox").Static<typeof MarkAnchorSchema>} MarkAnchor
 * @typedef {import("typebox").Static<typeof MarkSchema>} Mark
 * @typedef {import("typebox").Static<typeof DraftSchema>} Draft
 */

/**
 * The letter after the ones in use: A to Z, then AA, AB and so on.
 * A removed mark frees its letter.
 *
 * @param {Iterable<string>} used
 */
export function nextLetter(used) {
  const taken = new Set(used)
  for (let index = 0; ; index += 1) {
    const letter = letterAt(index)
    if (!taken.has(letter)) return letter
  }
}

/** 0 is A, 25 is Z, 26 is AA. @param {number} index */
export function letterAt(index) {
  let letter = ""
  let rest = index
  do {
    letter = String.fromCharCode(65 + (rest % 26)) + letter
    rest = Math.floor(rest / 26) - 1
  } while (rest >= 0)
  return letter
}
