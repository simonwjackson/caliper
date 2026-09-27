// @ts-check
import { Type } from "typebox"

/** A reference to an executable product-owned state, on disk or over the takes API. */
export const StateRefSchema = Type.Object({
  part: Type.String({ minLength: 1 }),
  state: Type.String({ minLength: 1 }),
}, { additionalProperties: false })

/** Keys are the parent part's state exports. The entries describe fixture intent only. */
export const CompositionSchema = Type.Record(Type.String(), Type.Array(StateRefSchema))
