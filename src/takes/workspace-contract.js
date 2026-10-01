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

/** A scratch row's file, relative to its workspace's folder. Caliper names it; the row agent writes it. */
export const ROW_FILE = /^rows\/[1-9]\d*\.part\.tsx$/
/** A scratch row's file, relative to the project root: the part path frames and checks use. */
export const ROW_PATH = /^\.caliper\/workspaces\/([1-9]\d*)\/(rows\/[1-9]\d*\.part\.tsx)$/
/** The project-relative path of a scratch row's file. @param {string} workspace @param {string} file */
export const rowPath = (workspace, file) => `.caliper/workspaces/${workspace}/${file}`
/** The longest row file, in characters. */
export const MAX_ROW = 300_000

/**
 * One row of the board: a declared state, or from slice 2 a scratch row, a
 * file in the workspace's folder with one state, its default export. `brief`
 * is what you asked the row agent.
 */
export const RowSchema = Type.Union([
  Type.Object({ _tag: Type.Literal("State"), part: Type.String({ minLength: 1, maxLength: 1024 }), state: Type.String({ minLength: 1, maxLength: 256 }) }, { additionalProperties: false }),
  Type.Object({ _tag: Type.Literal("Scratch"), file: Type.String({ pattern: ROW_FILE.source }), brief: text() }, { additionalProperties: false }),
])

/**
 * The part and state a row renders: a pinned state as it is, a scratch row as
 * its file's default export, by its project-relative path.
 *
 * @param {string} workspace
 * @param {import("typebox").Static<typeof RowSchema>} row
 * @returns {{ part: string, state: string }}
 */
export const rowRef = (workspace, row) => row._tag === "State" ? { part: row.part, state: row.state } : { part: rowPath(workspace, row.file), state: "default" }

/**
 * How one row's checks went in one column of the board (slice 2). `row` and
 * `state` are the row's part and state (`rowRef`); `column` is "today" or the
 * idea's take; `device` is where the checks ran. `stale`: the row, the idea or
 * the project changed after the run. `image` is a key the workspace serves at
 * `checks/<key>`.
 */
export const CellCheckSchema = Type.Object({
  row: Type.String(), state: Type.String(), column: Type.String(), device: Type.String(),
  status: Type.Union([Type.Literal("Waiting"), Type.Literal("Running"), Type.Literal("Done"), Type.Literal("Unknown")]),
  reason: Type.String(), stale: Type.Boolean(),
  results: Type.Array(Type.Object({
    name: Type.String(), line: Type.Integer({ minimum: 1 }),
    status: Type.Union([Type.Literal("Passed"), Type.Literal("Failed"), Type.Literal("Inconclusive"), Type.Literal("NotRun")]),
    detail: Type.String(), image: Type.Union([Type.String({ pattern: "^[a-f0-9]{16,64}$" }), Type.Null()]),
  }, { additionalProperties: false })),
}, { additionalProperties: false })

/** What a scratch row's file declares, read without running it. `written`: the file exists. */
export const ScratchFactsSchema = Type.Object({
  file: Type.String({ pattern: ROW_FILE.source }), written: Type.Boolean(), name: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
  checks: Type.Array(Type.Object({ name: Type.String(), line: Type.Integer({ minimum: 1 }) }, { additionalProperties: false })),
  problems: Type.Array(Type.String()),
}, { additionalProperties: false })

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
