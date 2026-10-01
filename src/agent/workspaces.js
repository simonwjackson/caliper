// @ts-check
import { Type } from "typebox"
import { Check } from "typebox/value"
import { json, MAX_BODY, readJson, refuse } from "../http.js"
import { unknownDevice } from "../render/plan.js"
import { MAX_TEXT, WORKSPACE_ID } from "../takes/workspace-contract.js"
import { MAX_IMAGES_BODY, readImages } from "./images.js"

/**
 * The workspaces API, under `/__caliper/workspaces` (decision 45). The Caliper
 * app's agent answers it, as it answers takes and marks, because a workspace's
 * ideas are takes its agents make. The workspace files stay in the project's
 * plugin, behind `workspaces`.
 *
 *   POST workspaces                            { question }        a new workspace
 *   POST workspaces/<id>/question              { question }        before it has ideas
 *   POST workspaces/<id>/rows                  { part, state, pinned }
 *   POST workspaces/<id>/questions             { text }            an open question
 *   POST workspaces/<id>/questions/<q>/answer  { answer, reason }
 *   POST workspaces/<id>/plan                  { count, device, images? }  directions, and a name
 *   POST workspaces/<id>/ideas                 { device, direction?, others?, prompt?, images? }
 *   POST workspaces/<id>/ideas/<take>/prompt   { prompt, images? }  a follow-up
 *   POST workspaces/<id>/ideas/<take>/stop     {}
 *   POST workspaces/<id>/ideas/<take>/discard  {}
 *   POST workspaces/<id>/discard               {}                  delete the ideas, close
 *
 * As for takes, the chrome asks for a plan and then starts one idea per
 * direction, so Cancel during planning starts nothing. Every view of a
 * workspace goes out with the takes, in `TakesSnapshot`.
 *
 * @typedef {import("./host-types").AgentWorkspaces} AgentWorkspaces
 * @typedef {import("../types").WorkspaceView} WorkspaceView
 * @typedef {import("../takes/workspaces.js").Workspace} Workspace
 */

/** The most ideas one plan makes. The chrome offers the same. */
const MAX_IDEAS = 4
const words = Type.String({ maxLength: MAX_TEXT })
const NewSchema = Type.Object({ question: Type.Optional(words) })
const QuestionSchema = Type.Object({ question: words })
const RowSchema = Type.Object({ part: Type.String({ minLength: 1, maxLength: 1024 }), state: Type.String({ minLength: 1, maxLength: 256 }), pinned: Type.Boolean() })
const AskSchema = Type.Object({ text: words })
const AnswerSchema = Type.Object({ answer: words, reason: words })
const DirectionSchema = Type.Object({ title: Type.String({ minLength: 1, maxLength: 80 }), brief: Type.String({ minLength: 1, maxLength: MAX_TEXT }), strange: Type.Optional(Type.Literal(true)) })
const PlanSchema = Type.Object({ count: Type.Integer(), device: Type.String({ minLength: 1 }) })
const IdeaSchema = Type.Object({ device: Type.String({ minLength: 1 }), direction: Type.Optional(DirectionSchema), others: Type.Optional(Type.Array(Type.String({ maxLength: 80 }), { maxItems: MAX_IDEAS })), prompt: Type.Optional(words) })
const PromptSchema = Type.Object({ prompt: words })

/**
 * @param {{
 *   workspaces: AgentWorkspaces,
 *   agents: Pick<ReturnType<typeof import("./take-agents.js").createTakeAgents>, "ideas" | "discard" | "start" | "follow" | "stop">,
 *   project: () => Promise<import("../types").Project>,
 *   plan: (input: { workspace: Workspace, count: number, device: string, images: import("./images.js").AttachedImage[] }) => Promise<import("../types").TakePlan & { name?: string }>,
 *   onChange: () => void,
 * }} input
 *   `plan` asks the planner for one direction per idea, from the question and its rows.
 */
export function createWorkspacesApi({ workspaces, agents, project, plan, onChange }) {
  /** @param {string} id */
  const ideasOf = async id => (await agents.ideas()).filter(idea => idea.workspace === id)

  /** Starting ideas and discarding them take turns, so no idea starts in a closed workspace. */
  /** @type {Map<string, Promise<unknown>>} */
  const queues = new Map()
  /** @template T @param {string} id @param {() => Promise<T>} run @returns {Promise<T>} */
  const serially = (id, run) => {
    const task = (queues.get(id) ?? Promise.resolve()).then(run)
    queues.set(id, task.catch(() => {}))
    return task
  }

  /** @returns {Promise<WorkspaceView[]>} every workspace with its ideas */
  const views = async () => {
    const [listed, ideas] = await Promise.all([workspaces.overview(), agents.ideas()])
    return listed.map(/** @returns {WorkspaceView} */ entry => entry._tag === "Damaged" ? entry : {
      _tag: "Ready", ...entry.workspace,
      ideas: ideas.filter(idea => idea.workspace === entry.workspace.id).map(({ workspace: _workspace, ...idea }) => idea),
      scratch: entry.scratch.map(facts => ({ ...facts, run: { _tag: /** @type {const} */ ("Idle") }, log: [] })),
      checks: [],
    })
  }

  /**
   * The workspace, open, with a question and at least one row: what a plan
   * and a new idea need.
   *
   * @param {string} id
   * @param {string} device
   */
  const ready = async (id, device) => {
    const workspace = /** @type {Workspace} */ (await workspaces.read(id))
    if (workspace.status._tag === "Closed") throw new Error(`Workspace ${id} is closed.`)
    if (workspace.question.trim() === "") throw new Error("Write the question first.")
    if (workspace.rows.length === 0) throw new Error("Pin a state first. Each pinned state is a row every idea renders.")
    const viewed = await project()
    if (!viewed.devices.some(candidate => candidate.id === device)) throw new Error(unknownDevice(viewed, device))
    return workspace
  }

  /**
   * Delete every idea, stopping the ones that still work, then close. The
   * question, the rows, and every question and answer stay.
   *
   * @param {string} id
   */
  const discard = async id => serially(id, async () => {
    for (const idea of await ideasOf(id)) await agents.discard(idea.take)
    await workspaces.close(id)
  })

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
      // A plan, a new idea and a follow-up can carry images.
      const carriesImages = /^\/workspaces\/[^/]+\/(?:plan|ideas(?:\/[^/]+\/prompt)?)$/.test(path)
      const body = await readJson(request, carriesImages ? MAX_IMAGES_BODY : MAX_BODY)
      if (path === "/workspaces") {
        if (!Check(NewSchema, body)) throw new Error(`A new workspace takes a question of at most ${MAX_TEXT} characters.`)
        const made = await workspaces.create(body.question ?? "")
        onChange()
        json(response, 201, { workspace: made.id })
        return true
      }
      const [, , id = "", action = "", item = "", step = ""] = path.split("/")
      if (!WORKSPACE_ID.test(id) || await workspaces.read(id) === null) {
        json(response, 404, { error: `Workspace ${id} does not exist.` })
        return true
      }
      if (action === "question" && item === "") {
        if (!Check(QuestionSchema, body)) throw new Error("Send the question as text.")
        if ((await ideasOf(id)).length > 0) throw new Error("Ideas already answer this question. Start a new workspace for another question.")
        await workspaces.setQuestion(id, body.question)
        json(response, 200, { workspace: id })
      } else if (action === "rows" && item === "") {
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
      } else if (action === "questions" && item === "") {
        if (!Check(AskSchema, body)) throw new Error("Send the question as text.")
        const asked = await workspaces.ask(id, body.text, { _tag: "User" })
        json(response, 201, { question: asked.questions.at(-1)?.id })
      } else if (action === "questions" && step === "answer") {
        if (!Check(AnswerSchema, body)) throw new Error("An answer needs the answer and its reason.")
        await workspaces.answer(id, item, body.answer, body.reason)
        json(response, 200, { workspace: id })
      } else if (action === "plan" && item === "") {
        if (!Check(PlanSchema, body)) throw new Error("A plan needs the number of ideas and the device.")
        if (body.count < 2 || body.count > MAX_IDEAS) throw new Error(`Ask the planner for 2 to ${MAX_IDEAS} ideas.`)
        const workspace = await ready(id, body.device)
        const planned = await plan({ workspace, count: body.count, device: body.device, images: readImages(body) })
        // The name describes the question, so a cancelled plan may keep it.
        if (planned.name !== undefined && workspace.name === undefined) await workspaces.setName(id, planned.name)
        json(response, 200, planned)
      } else if (action === "ideas" && item === "") {
        if (!Check(IdeaSchema, body)) throw new Error("A new idea needs the device, and a direction or a description.")
        const images = readImages(body)
        const take = await serially(id, async () => {
          const workspace = await ready(id, body.device)
          const prompt = body.prompt?.trim() || workspace.question
          return agents.start({
            subject: { _tag: "Idea", workspace: id }, device: body.device, prompt, images,
            ...(body.direction === undefined ? {} : { direction: body.direction, others: body.others ?? [] }),
          })
        })
        onChange()
        json(response, 201, { take })
        return true
      } else if (action === "ideas" && /^[1-9]\d*$/.test(item) && ["prompt", "stop", "discard"].includes(step)) {
        if (!(await ideasOf(id)).some(idea => idea.take === item)) {
          json(response, 404, { error: `Workspace ${id} has no idea ${item}.` })
          return true
        }
        if (step === "prompt") {
          if (!Check(PromptSchema, body) || body.prompt.trim() === "") throw new Error("The prompt is empty.")
          await agents.follow(item, body.prompt.trim(), readImages(body))
        } else if (step === "stop") {
          await agents.stop(item)
        } else {
          await serially(id, () => agents.discard(item))
        }
        json(response, 200, { take: item })
      } else if (action === "discard" && item === "") {
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
