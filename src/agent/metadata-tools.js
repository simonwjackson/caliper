// @ts-check
import { Type } from "typebox"
import { Value } from "typebox/value"
import { integrationProposalSchema } from "../takes/integration.js"
import { isIdea } from "../takes/store.js"

/** @typedef {import('@earendil-works/pi-agent-core').AgentTool<any>} AgentTool */

const pathSchema = Type.Object({ path: Type.String({ minLength: 1 }) }, { additionalProperties: false })
const nameSchema = Type.Object({ name: Type.String({ minLength: 1, maxLength: 80, pattern: "^[^\\r\\n]+$" }) }, { additionalProperties: false })
const questionSchema = Type.Object({ text: Type.String({ minLength: 1, maxLength: 2000 }) }, { additionalProperties: false })

/**
 * Metadata tools never write product files. Integration tools can restore a
 * take copy, but cannot remove an original file.
 * @param {{ store: import('./host-types').AgentStore, take: string, onChange: () => void, integration: import('./host-types').AgentIntegration, workspaces?: import('./host-types').AgentWorkspaces }} input
 *   `workspaces` lets an idea ask its workspace a question (decision 45).
 * @returns {Promise<AgentTool[]>}
 */
export async function metadataTools({ store, take, onChange, integration, workspaces }) {
  /** @param {string} message */
  const result = message => ({ content: [{ type: /** @type {const} */ ("text"), text: message }], details: {} })
  /** @type {AgentTool[]} */
  const tools = [{
    name: "name_take", label: "Name take",
    description: "Give this take a short descriptive name, two to five words about the design, not a take number. Update it if the direction changes.",
    parameters: nameSchema,
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted()
      if (!Value.Check(nameSchema, params) || params.name.trim() === "") throw new Error("A take name must be 1 to 80 characters on one line.")
      await store.update(take, { name: params.name.trim() })
      onChange()
      return result(`Named take ${take}: ${params.name.trim()}`)
    },
  }]
  const record = await store.record(take)
  if (record !== null && isIdea(record) && workspaces !== undefined) {
    const workspace = record.subject.workspace
    tools.push({
      name: "ask_question", label: "Ask question",
      description: "Add an open question to the workspace, for the user to answer with a reason: a decision the question leaves open that your idea depends on, or a problem you found that the user must know about. One question per call. It does not stop your work.",
      parameters: questionSchema,
      execute: async (_id, params, signal) => {
        signal?.throwIfAborted()
        if (!Value.Check(questionSchema, params) || params.text.trim() === "") throw new Error("A question needs text, at most 2000 characters.")
        // The title as it is now; it stays with the question after the idea is discarded.
        const now = await store.record(take)
        const title = (now?.name ?? now?.direction?.title ?? `Idea ${take}`).slice(0, 80)
        await workspaces.ask(workspace, params.text.trim(), { _tag: "Idea", take, created: record.created, title })
        onChange()
        return result(`Asked the workspace: ${params.text.trim()}`)
      },
    })
  }
  if (!record?.integration) return tools
  tools.push({
    name: "read_original", label: "Read original",
    description: "Read a real project file before this take's edits. Compare it with read_file to preserve existing callers.",
    parameters: pathSchema,
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted()
      if (!Value.Check(pathSchema, params)) throw new Error("Supply a project path.")
      const original = await store.original(params.path)
      signal?.throwIfAborted()
      return result(original ?? "This file does not exist in the original project.")
    },
  }, {
    name: "reset_file", label: "Restore original",
    description: "Remove this take's edited copy of a file. The take uses the real file again. This never deletes a real file.",
    parameters: pathSchema,
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted()
      if (!Value.Check(pathSchema, params)) throw new Error("Supply a project path.")
      await store.reset(take, params.path)
      onChange()
      return result(`Restored original ${params.path} in the take.`)
    },
  }, {
    name: "submit_integration", label: "Submit integration",
    description: "After all edits and renders, submit the integration for human review. Describe the new explicit choice and how existing callers stay unchanged. This does not apply files. Any later edit requires submitting again.",
    parameters: integrationProposalSchema,
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted()
      await integration.submit(take, params)
      onChange()
      return result("Integration submitted. The user must review the files and run checks before applying it.")
    },
  })
  return tools
}
