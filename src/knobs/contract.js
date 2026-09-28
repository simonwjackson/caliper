// @ts-check
import { Type } from "typebox"

/** What the chrome and the knobs API send each other (decisions 23 and 26). */

const take = Type.Union([Type.String({ pattern: "^[1-9][0-9]*$" }), Type.Null()])
const index = Type.Integer({ minimum: 0 })
const path = Type.Array(index, { minItems: 1, maxItems: 16 })
const name = Type.String({ minLength: 1, maxLength: 4096 })

export const RuleSummarySchema = Type.Object({
  path,
  kind: Type.String({ minLength: 1, maxLength: 64 }),
  selector: Type.Optional(Type.String({ maxLength: 16384 })),
  name: Type.Optional(Type.String({ maxLength: 256 })),
}, { additionalProperties: false })

export const LocateRequestSchema = Type.Object({
  /** The `<style>`'s `data-vite-dev-id`: the module id, with `?take=<n>` in a take's frame. */
  sheet: name,
  take,
  css: Type.String({ maxLength: 4 * 1024 * 1024 }),
  rules: Type.Array(RuleSummarySchema, { maxItems: 100000 }),
  targets: Type.Array(Type.Object({ path, property: Type.String({ minLength: 1, maxLength: 256 }) }, { additionalProperties: false }), { minItems: 1, maxItems: 1000 }),
}, { additionalProperties: false })

export const WriteRequestSchema = Type.Object({
  file: name,
  take,
  version: Type.String({ pattern: "^[0-9a-f]{16}$" }),
  start: index,
  end: index,
  expected: Type.String({ maxLength: 4096 }),
  value: Type.String({ minLength: 1, maxLength: 512 }),
}, { additionalProperties: false })

const span = Type.Object({
  file: name,
  version: Type.String({ pattern: "^[0-9a-f]{16}$" }),
  start: index,
  end: index,
  expected: Type.String({ minLength: 1, maxLength: 4096 }),
}, { additionalProperties: false })

/** Promote a literal to a token: `literal` is the value, `home` a custom property declaration the token goes after. */
export const PromoteRequestSchema = Type.Object({
  take,
  name: Type.String({ pattern: "^--[A-Za-z_][A-Za-z0-9_-]*$", maxLength: 128 }),
  literal: span,
  home: span,
}, { additionalProperties: false })

const number = Type.Number()
export const KnobHintsSchema = Type.Object({
  label: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  min: Type.Optional(number),
  max: Type.Optional(number),
  step: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
  ignore: Type.Optional(Type.Boolean()),
}, { additionalProperties: false })

/** `caliper({ knobs })`: hints by custom property name, for CSS a project cannot annotate. */
export const KnobOptionsSchema = Type.Record(Type.String({ pattern: "^--[A-Za-z0-9_-]+$" }), KnobHintsSchema, { additionalProperties: false })

/** @typedef {import("typebox").Static<typeof LocateRequestSchema>} LocateRequest */
/** @typedef {import("typebox").Static<typeof WriteRequestSchema>} WriteRequest */
/** @typedef {import("typebox").Static<typeof PromoteRequestSchema>} PromoteRequest */
