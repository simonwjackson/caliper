// @ts-check
import { Type } from "typebox"
import { Value } from "typebox/value"
import { integrationProposalSchema } from "../takes/integration.js"

/** @typedef {import('@earendil-works/pi-agent-core').AgentTool<any>} AgentTool */

const pathSchema = Type.Object({ path: Type.String({ minLength: 1 }) }, { additionalProperties: false })
const nameSchema = Type.Object({ name: Type.String({ minLength: 1, maxLength: 80, pattern: "^[^\\r\\n]+$" }) }, { additionalProperties: false })

/**
 * Metadata tools never write product files. Integration tools can restore a
 * take copy, but cannot remove an original file.
 * @param {{ store: import('../takes/store.js').TakeStore, take: string, onChange: () => void, integration: ReturnType<typeof import('../takes/integration.js').createIntegrationReview> }} input
 * @returns {AgentTool[]}
 */
export function metadataTools({ store, take, onChange, integration }) {
  /** @param {string} message */
  const result = message => ({ content: [{ type: /** @type {const} */ ("text"), text: message }], details: {} })
  /** @type {AgentTool[]} */
  const tools = [{
    name: "name_take", label: "Name take",
    description: "Give this take a short descriptive name, two to five words about the design, not a take number. Update it if the direction changes.",
    parameters: nameSchema,
    execute: async (_id, params) => {
      if (!Value.Check(nameSchema, params) || params.name.trim() === "") throw new Error("A take name must be 1 to 80 characters on one line.")
      store.update(take, { name: params.name.trim() })
      onChange()
      return result(`Named take ${take}: ${params.name.trim()}`)
    },
  }]
  if (!store.record(take)?.integration) return tools
  tools.push({
    name: "read_original", label: "Read original",
    description: "Read a real project file before this take's edits. Compare it with read_file to preserve existing callers.",
    parameters: pathSchema,
    execute: async (_id, params) => {
      if (!Value.Check(pathSchema, params)) throw new Error("Supply a project path.")
      return result(store.original(params.path) ?? "This file does not exist in the original project.")
    },
  }, {
    name: "reset_file", label: "Restore original",
    description: "Remove this take's edited copy of a file. The take uses the real file again. This never deletes a real file.",
    parameters: pathSchema,
    execute: async (_id, params) => {
      if (!Value.Check(pathSchema, params)) throw new Error("Supply a project path.")
      store.reset(take, params.path)
      onChange()
      return result(`Restored original ${params.path} in the take.`)
    },
  }, {
    name: "submit_integration", label: "Submit integration",
    description: "After all edits and renders, submit the integration for human review. Describe the new explicit choice and how existing callers stay unchanged. This does not apply files. Any later edit requires submitting again.",
    parameters: integrationProposalSchema,
    execute: async (_id, params) => {
      integration.submit(take, params)
      onChange()
      return result("Integration submitted. The user must review the files and run checks before applying it.")
    },
  })
  return tools
}
