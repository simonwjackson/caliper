// @ts-check
import { Type } from "typebox"
import { CheckReportSchema } from "../render/check-contract.js"

const text = Type.String({ minLength: 1, maxLength: 1024, pattern: "\\S" })
const id = Type.String({ pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$" })
export const CheckRequestSchema = Type.Object({
  part: text, state: text, take: Type.Optional(Type.String({ pattern: "^[1-9][0-9]*$" })),
}, { additionalProperties: false })
export const ApproveCheckSchema = Type.Object({
  id, index: Type.Integer({ minimum: 0 }), reviewed: Type.Literal(true),
}, { additionalProperties: false })
export const ChecksViewSchema = Type.Union([
  Type.Object({ _tag: Type.Literal("Idle") }, { additionalProperties: false }),
  Type.Object({ _tag: Type.Literal("Running"), id, request: CheckRequestSchema, startedAt: Type.String(), total: Type.Integer({ minimum: 1 }) }, { additionalProperties: false }),
  Type.Object({ _tag: Type.Literal("Ready"), id, request: CheckRequestSchema, report: CheckReportSchema, stale: Type.Boolean(), approved: Type.Array(Type.Integer({ minimum: 0 }), { uniqueItems: true }) }, { additionalProperties: false }),
  Type.Object({ _tag: Type.Literal("Failed"), id, request: CheckRequestSchema, reason: Type.String() }, { additionalProperties: false }),
])

/** @typedef {import("typebox").Static<typeof CheckRequestSchema>} CheckRequest */
/** @typedef {import("typebox").Static<typeof ChecksViewSchema>} ChecksView */
