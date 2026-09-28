// @ts-check
import { Type } from "typebox"

export const CheckSchema = Type.Object({
  name: Type.Union([Type.Literal("render"), Type.Literal("browser"), Type.Literal("spill"), Type.Literal("accessibility"), Type.Literal("determinism"), Type.Literal("baseline")]),
  status: Type.Union([Type.Literal("Passed"), Type.Literal("Failed"), Type.Literal("Review"), Type.Literal("Inconclusive"), Type.Literal("NotRun")]),
  detail: Type.String(),
  image: Type.Optional(Type.String()),
})

const Digest = Type.String({ pattern: "^[a-f0-9]{64}$" })
const Frame = Type.Union([Type.Literal("Rendered"), Type.Literal("Empty"), Type.Literal("Failed")])
export const CheckResultSchema = Type.Object({
  part: Type.String({ minLength: 1 }), state: Type.String({ minLength: 1 }), device: Type.String({ minLength: 1 }),
  take: Type.Optional(Type.String({ pattern: "^[1-9][0-9]*$" })),
  frame: Frame,
  viewport: Type.Object({ width: Type.Number(), height: Type.Number() }),
  png: Type.String(), repeatPng: Type.String(), sha256: Digest, repeatSha256: Digest,
  checks: Type.Array(CheckSchema),
})
export const CheckReportSchema = Type.Object({
  version: Type.Literal(1), project: Type.String({ minLength: 1 }), environment: Type.String({ minLength: 1 }),
  createdAt: Type.String(), coverage: Type.String(),
  results: Type.Array(CheckResultSchema, { minItems: 1 }),
})
export const BaselineSchema = Type.Object({
  version: Type.Literal(1), project: Type.String(), environment: Type.String(),
  part: Type.String(), state: Type.String(), device: Type.String(),
  frame: Frame, viewport: Type.Object({ width: Type.Number(), height: Type.Number() }), sha256: Digest,
})

/** @typedef {import("typebox").Static<typeof CheckSchema>} CheckResult */
/** @typedef {import("typebox").Static<typeof CheckReportSchema>} CheckReport */
/** @typedef {import("typebox").Static<typeof BaselineSchema>} Baseline */
/**
 * @typedef {{ id: string, impact: string | null, help: string, url: string, nodes: Array<{ target: string, summary: string }> }} AccessibilityFinding
 * @typedef {{ _tag: "Complete", violations: AccessibilityFinding[], incomplete: AccessibilityFinding[] } | { _tag: "Unavailable", reason: string }} Accessibility
 */
