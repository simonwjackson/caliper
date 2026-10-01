// @ts-check
import { Type } from "typebox"
import { TakeIdentitySchema } from "./marks-contract.js"

/**
 * Browser-safe schemas of a workspace (decision 45). The dev server keeps
 * each one in `.caliper/workspaces/<id>/workspace.json`; the chrome checks
 * what it receives.
 *
 * A workspace does not list its ideas. Each idea's take record names its
 * workspace (`subject`), so the two cannot disagree.
 */

const at = Type.Number({ minimum: 0, maximum: 8.64e15 })
const text = (maxLength = MAX_TEXT) => Type.String({ maxLength })

export const WORKSPACE_ID = /^[1-9]\d*$/
/** The longest question, answer or reason. The prompt of a take has the same limit. */
export const MAX_TEXT = 8_000
export const MAX_ROWS = 24
export const MAX_QUESTIONS = 200

/** One row of the board. Slice 1 has only declared states; scratch rows come in slice 2. */
export const RowSchema = Type.Union([
  Type.Object({ _tag: Type.Literal("State"), part: Type.String({ minLength: 1, maxLength: 1024 }), state: Type.String({ minLength: 1, maxLength: 256 }) }, { additionalProperties: false }),
])

/** Who asked a question: you, or the agent of an idea. The idea's title stays after a discard. */
export const AskerSchema = Type.Union([
  Type.Object({ _tag: Type.Literal("User") }, { additionalProperties: false }),
  Type.Object({ _tag: Type.Literal("Idea"), take: Type.String({ pattern: "^[1-9][0-9]*$" }), created: at, title: text(80) }, { additionalProperties: false }),
])

export const QuestionSchema = Type.Union([
  Type.Object({ _tag: Type.Literal("Open"), id: Type.String({ pattern: "^[1-9][0-9]*$" }), text: text(), by: AskerSchema, asked: at }, { additionalProperties: false }),
  Type.Object({
    _tag: Type.Literal("Answered"), id: Type.String({ pattern: "^[1-9][0-9]*$" }), text: text(), by: AskerSchema, asked: at,
    answer: text(), reason: text(), at,
  }, { additionalProperties: false }),
])

/** Closed lists the ideas it promoted. Slice 1 has no promote, so a closed workspace was discarded. */
export const WorkspaceStatusSchema = Type.Union([
  Type.Object({ _tag: Type.Literal("Open") }, { additionalProperties: false }),
  Type.Object({ _tag: Type.Literal("Closed"), at, promoted: Type.Array(TakeIdentitySchema) }, { additionalProperties: false }),
])

export const WorkspaceSchema = Type.Object({
  id: Type.String({ pattern: "^[1-9][0-9]*$" }),
  created: at,
  /** Empty until you write it. */
  question: text(),
  /** A few words the planner gives the question. */
  name: Type.Optional(text(80)),
  status: WorkspaceStatusSchema,
  rows: Type.Array(RowSchema, { maxItems: MAX_ROWS }),
  questions: Type.Array(QuestionSchema, { maxItems: MAX_QUESTIONS }),
}, { additionalProperties: false })
