// @ts-check
import { Type } from "typebox"

const text = (maxLength = 4000) => Type.String({ minLength: 1, maxLength, pattern: "\\S" })
/** Browser-safe schema shared by the take server and the chrome's wire adapter. */
export const integrationProposalSchema = Type.Object({
  strategy: Type.Union([Type.Literal("variant"), Type.Literal("component")]),
  summary: text(2000),
  shared: text(2000),
  preserved: text(2000),
  usage: text(),
  preview: Type.Object({ part: text(1024), state: text(200) }, { additionalProperties: false }),
}, { additionalProperties: false })
