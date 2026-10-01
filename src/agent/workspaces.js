// @ts-check
import { Type } from "typebox"
import { Check } from "typebox/value"
import { json, readJson, refuse } from "../http.js"
import { MAX_TEXT, WORKSPACE_ID } from "../takes/workspace-contract.js"

/**
 * The workspaces API, under `/__caliper/workspaces` (decision 45). The Caliper
 * app's agent answers it, as it answers takes and marks, because a workspace's
 * ideas are takes its agents make. The workspace files stay in the project's
 * plugin, behind `workspaces`.
 *
 *   POST workspaces                          { question }        a new workspace
 *   POST workspaces/<id>/question            { question }        before it has ideas
 *   POST workspaces/<id>/rows                { part, state, pinned }
 *   POST workspaces/<id>/questions           { text }            an open question
 *   POST workspaces/<id>/questions/<q>/answer { answer, reason }
 *   POST workspaces/<id>/discard             {}                  delete the ideas, close
 *
 * Every view of a workspace goes out with the takes, in `TakesSnapshot`.
 *
 * @typedef {import("./host-types").AgentWorkspaces} AgentWorkspaces
 * @typedef {import("../types").WorkspaceView} WorkspaceView
 */

const words = Type.String({ maxLength: MAX_TEXT })
const NewSchema = Type.Object({ question: Type.Optional(words) })
const QuestionSchema = Type.Object({ question: words })
const RowSchema = Type.Object({ part: Type.String({ minLength: 1, maxLength: 1024 }), state: Type.String({ minLength: 1, maxLength: 256 }), pinned: Type.Boolean() })
const AskSchema = Type.Object({ text: words })
const AnswerSchema = Type.Object({ answer: words, reason: words })

/**
 * @param {{
 *   workspaces: AgentWorkspaces,
 *   agents: Pick<ReturnType<typeof import("./take-agents.js").createTakeAgents>, "ideas" | "discard">,
 *   project: () => Promise<import("../types").Project>,
 *   onChange: () => void,
 * }} input
 */
export function createWorkspacesApi({ workspaces, agents, project, onChange }) {
  /** @param {string} id */
  const ideasOf = async id => (await agents.ideas()).filter(idea => idea.workspace === id)

  /** @returns {Promise<WorkspaceView[]>} every workspace with its ideas */
  const views = async () => {
    const [listed, ideas] = await Promise.all([workspaces.overview(), agents.ideas()])
    return listed.map(/** @returns {WorkspaceView} */ entry => entry._tag === "Damaged" ? entry : {
      _tag: "Ready", ...entry.workspace,
      ideas: ideas.filter(idea => idea.workspace === entry.workspace.id).map(({ workspace: _workspace, ...idea }) => idea),
    })
  }

  /**
   * Delete every idea, stopping the ones that still work, then close. The
   * question, the rows, and every question and answer stay.
   *
   * @param {string} id
   */
  const discard = async id => {
    for (const idea of await ideasOf(id)) await agents.discard(idea.take)
    await workspaces.close(id)
  }

  /**
   * @param {string} path below `/__caliper`
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   * @returns {Promise<boolean>} false when the path is not a workspace route
   */
  const handle = async (path, request, response) => {
    if (path !== "/workspaces" && !path.startsWith("/workspaces/")) return false
    const refusal = refuse(request)
    if (refusal !== null) {
      json(response, 403, { error: refusal })
      return true
    }
    try {
      const body = await readJson(request)
      if (path === "/workspaces") {
        if (!Check(NewSchema, body)) throw new Error(`A new workspace takes a question of at most ${MAX_TEXT} characters.`)
        const made = await workspaces.create(body.question ?? "")
        onChange()
        json(response, 201, { workspace: made.id })
        return true
      }
      const [, , id = "", action = "", question = "", step = ""] = path.split("/")
      if (!WORKSPACE_ID.test(id) || await workspaces.read(id) === null) {
        json(response, 404, { error: `Workspace ${id} does not exist.` })
        return true
      }
      if (action === "question" && question === "") {
        if (!Check(QuestionSchema, body)) throw new Error("Send the question as text.")
        if ((await ideasOf(id)).length > 0) throw new Error("Ideas already answer this question. Start a new workspace for another question.")
        await workspaces.setQuestion(id, body.question)
        json(response, 200, { workspace: id })
      } else if (action === "rows" && question === "") {
        if (!Check(RowSchema, body)) throw new Error("A row needs a part, a state and whether it is pinned.")
        const row = { _tag: /** @type {const} */ ("State"), part: body.part, state: body.state }
        if (body.pinned) {
          const { parts } = await project()
          const part = parts.find(candidate => candidate.file === row.part)
          if (part === undefined) throw new Error(`"${row.part}" is not a part.`)
          if (!part.states.some(state => state.export === row.state)) throw new Error(`${part.file} has no state "${row.state}".`)
          await workspaces.pin(id, row)
        } else {
          await workspaces.unpin(id, row)
        }
        json(response, 200, { workspace: id })
      } else if (action === "questions" && question === "") {
        if (!Check(AskSchema, body)) throw new Error("Send the question as text.")
        const asked = await workspaces.ask(id, body.text, { _tag: "User" })
        json(response, 201, { question: asked.questions.at(-1)?.id })
      } else if (action === "questions" && step === "answer") {
        if (!Check(AnswerSchema, body)) throw new Error("An answer needs the answer and its reason.")
        await workspaces.answer(id, question, body.answer, body.reason)
        json(response, 200, { workspace: id })
      } else if (action === "discard" && question === "") {
        await discard(id)
        json(response, 200, { workspace: id })
      } else {
        json(response, 404, { error: `Workspaces have no action "${path.split("/").slice(3).join("/")}".` })
        return true
      }
      onChange()
    } catch (error) {
      onChange()
      json(response, 400, { error: error instanceof Error ? error.message : String(error) })
    }
    return true
  }

  return { handle, views }
}
