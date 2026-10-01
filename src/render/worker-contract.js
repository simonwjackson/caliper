// @ts-check
import { Type } from "typebox"
import { AuthoredResultSchema, CheckRunSchema } from "../authored/contract.js"
import { StateExpectationsSchema } from "../expectation-contract.js"
import { CheckReportSchema, CheckSchema } from "./check-contract.js"
import { MarkAnchorSchema } from "../takes/marks-contract.js"

const Text = Type.String()
const Viewport = Type.Object({ width: Type.Number(), height: Type.Number() })
const Job = Type.Object({
  part: Text, state: Text, device: Text, viewport: Viewport, take: Type.Optional(Text),
  annotations: Type.Optional(Type.Array(Type.Object({ letter: Text, anchor: MarkAnchorSchema, crop: Type.Optional(Type.Boolean()) }))),
})
const Annotated = Type.Object({
  png: Text,
  marks: Type.Array(Type.Object({ letter: Text, found: Type.Boolean(), visible: Type.Boolean(), crop: Type.Optional(Text) })),
})
const fields = { url: Text, jobs: Type.Array(Job), out: Text, executablePath: Text }
export const WorkerRequestSchema = Type.Union([
  Type.Object({
    type: Type.Literal("render"),
    input: Type.Object({ ...fields, audit: Type.Optional(Type.Boolean()) }),
  }),
  Type.Object({
    type: Type.Literal("checks"),
    input: Type.Object({ ...fields, project: Text, baselines: Type.Optional(Text) }),
  }),
  Type.Object({ type: Type.Literal("cancel"), reason: Text }),
])
const Finding = Type.Object({
  id: Text,
  impact: Type.Union([Text, Type.Null()]),
  help: Text,
  url: Text,
  nodes: Type.Array(Type.Object({ target: Text, summary: Text })),
})
const Spill = Type.Object({
  left: Type.Number(),
  top: Type.Number(),
  right: Type.Number(),
  bottom: Type.Number(),
  elements: Type.Array(
    Type.Object({
      element: Text,
      target: Type.Optional(Text),
      left: Type.Number(),
      top: Type.Number(),
      right: Type.Number(),
      bottom: Type.Number(),
    }),
  ),
  complete: Type.Optional(Type.Boolean()),
})
export const RenderTransportSchema = Type.Object({
  ...Job.properties,
  frame: Type.Union([Type.Literal("Rendered"), Type.Literal("Empty"), Type.Literal("Failed")]),
  png: Text,
  problems: Type.Array(
    Type.Object({ kind: Type.Union([Type.Literal("error"), Type.Literal("warning")]), title: Text, detail: Text }),
  ),
  console: Type.Array(Text),
  spill: Type.Union([Type.Null(), Spill]),
  accessibility: Type.Optional(
    Type.Union([
      Type.Object({ _tag: Type.Literal("Complete"), violations: Type.Array(Finding), incomplete: Type.Array(Finding) }),
      Type.Object({ _tag: Type.Literal("Unavailable"), reason: Text }),
    ]),
  ),
  environment: Type.Optional(Text),
  checks: Type.Optional(Type.Array(CheckSchema)),
  authored: Type.Optional(AuthoredResultSchema),
  checkReport: Type.Optional(Text),
  checkRun: Type.Optional(CheckRunSchema),
  expectations: Type.Optional(StateExpectationsSchema),
  expectationProblems: Type.Optional(Type.Array(Text)),
  annotated: Type.Optional(Annotated),
})
export const WorkerReplySchema = Type.Union([
  Type.Object({ type: Type.Literal("render"), results: Type.Array(RenderTransportSchema) }),
  Type.Object({
    type: Type.Literal("checks"),
    results: Type.Array(RenderTransportSchema),
    report: CheckReportSchema,
    reportPath: Text,
  }),
  Type.Object({
    type: Type.Literal("progress"),
    progress: Type.Object({ phase: Text, completed: Type.Number(), total: Type.Number() }),
  }),
  Type.Object({ type: Type.Literal("error"), name: Text, message: Text }),
])
/** @typedef {import('typebox').Static<typeof WorkerRequestSchema>} WorkerRequest */
/** @typedef {import('typebox').Static<typeof WorkerReplySchema>} WorkerReply */
