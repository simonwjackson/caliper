// @ts-check
import { Type } from "typebox"

/**
 * Browser-safe schema of the accept log. The dev server keeps it in
 * `.caliper/accepted.json`, one entry per accept, oldest first, and sends it
 * with the takes. The chrome flags a take made before a later accept that
 * touched its part or one of its files (planner choice 15, answered C).
 */
export const AcceptRecordSchema = Type.Object({
  take: Type.String({ pattern: "^[1-9][0-9]*$" }),
  created: Type.Number({ minimum: 0, maximum: 8.64e15 }),
  part: Type.String(),
  state: Type.String(),
  files: Type.Array(Type.String()),
  at: Type.Number({ minimum: 0, maximum: 8.64e15 }),
}, { additionalProperties: false })

/**
 * The log keeps its newest entries, so the file and each takes event stay small.
 * Cost: an accept older than the newest 200 no longer flags anything.
 */
export const MAX_ACCEPTED = 200
