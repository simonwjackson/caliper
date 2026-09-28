// @ts-check
import { Type } from "typebox"

const text = Type.String({ minLength: 1 })
export const CheckDeclarationSchema = Type.Object({
  name: text,
  line: Type.Integer({ minimum: 1 }),
  hash: Type.String(),
})
export const SourceRevisionSchema = Type.Object({
  epoch: text,
  generation: Type.Integer({ minimum: 0 }),
  fingerprint: text,
})
export const CheckProvenanceSchema = Type.Object({
  kind: Type.Union([Type.Literal("Original"), Type.Literal("Take")]),
  take: Type.Optional(text),
  files: Type.Array(text),
  changedDeclarations: Type.Array(text),
})
export const CheckSourceSchema = Type.Object({
  root: text,
  revision: SourceRevisionSchema,
  provenance: CheckProvenanceSchema,
  parts: Type.Array(
    Type.Object({
      file: text,
      authoredChecks: Type.Record(Type.String(), Type.Array(CheckDeclarationSchema)),
      authoredCheckProblems: Type.Array(Type.String()),
    }),
  ),
})
const Status = Type.Union([
  Type.Literal("Passed"),
  Type.Literal("Failed"),
  Type.Literal("Inconclusive"),
  Type.Literal("NotRun"),
])
export const AuthoredCaseSchema = Type.Object({
  name: text,
  source: Type.Object({ file: text, line: Type.Integer({ minimum: 1 }) }),
  status: Status,
  reason: text,
  detail: Type.String(),
  durationMs: Type.Number({ minimum: 0 }),
  errors: Type.Array(Type.String()),
  image: Type.Optional(text),
  imageSha256: Type.Optional(text),
  evidenceError: Type.Optional(Type.String()),
})
export const AuthoredResultSchema = Type.Object({
  status: Status,
  reason: text,
  checks: Type.Array(AuthoredCaseSchema),
  provenance: CheckProvenanceSchema,
})
export const CheckRunSchema = Type.Object({
  id: text,
  termination: Type.Union([
    Type.Literal("Completed"),
    Type.Literal("Cancelled"),
    Type.Literal("SourceChanged"),
    Type.Literal("Infrastructure"),
  ]),
  source: SourceRevisionSchema,
  stale: Type.Boolean(),
})
/** @typedef {import('typebox').Static<typeof CheckDeclarationSchema>} CheckDeclaration */
/** @typedef {import('typebox').Static<typeof CheckSourceSchema>} CheckSource */
/** @typedef {import('typebox').Static<typeof SourceRevisionSchema>} SourceRevision */
/** @typedef {import('typebox').Static<typeof AuthoredCaseSchema>} AuthoredCase */
/** @typedef {import('typebox').Static<typeof AuthoredResultSchema>} AuthoredResult */
/** @typedef {import('typebox').Static<typeof CheckRunSchema>} CheckRun */
/** @typedef {import('typebox').Static<typeof CheckProvenanceSchema>} CheckProvenance */
