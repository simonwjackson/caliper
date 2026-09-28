// @ts-check
import { Type } from "typebox"

const Text = Type.String({ minLength: 1, pattern: "\\S" })
const Reason = Type.Object({ reason: Text }, { additionalProperties: false })
export const SpillExpectationSchema = Type.Object({
  target: Text,
  edge: Type.Union([Type.Literal("left"), Type.Literal("top"), Type.Literal("right"), Type.Literal("bottom")]),
  maxPixels: Type.Number({ exclusiveMinimum: 0 }),
  reason: Text,
}, { additionalProperties: false })
export const AccessibilityExpectationSchema = Type.Object({
  rule: Text,
  // Exact axe target, copied from a finding. This is not a CSS wildcard filter.
  target: Type.Array(Type.Union([Text, Type.Array(Text, { minItems: 2 })]), { minItems: 1 }),
  reason: Text,
}, { additionalProperties: false })
export const StateExpectationsSchema = Type.Object({
  empty: Type.Optional(Reason),
  spill: Type.Optional(Type.Array(SpillExpectationSchema, { minItems: 1 })),
  accessibility: Type.Optional(Type.Array(AccessibilityExpectationSchema, { minItems: 1 })),
}, { additionalProperties: false, minProperties: 1 })
export const ExpectationsSchema = Type.Record(Text, StateExpectationsSchema)

/** @typedef {import("typebox").Static<typeof StateExpectationsSchema>} StateExpectations */
/** @typedef {import("typebox").Static<typeof ExpectationsSchema>} Expectations */
