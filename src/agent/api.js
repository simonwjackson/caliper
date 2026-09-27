// @ts-check
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEVICES } from "../client/device-frame.js"
import { planRenders } from "../render/plan.js"
import { renderJobs } from "../render/render.js"
import { isTakeId } from "../takes/store.js"
import { connectEngine } from "./model.js"
import { planDirections } from "./planner.js"
import { createTakeAgents } from "./take-agents.js"
import { takeParts } from "../takes/parts.js"
import { verifyIntegration } from "./verify-integration.js"
import { Type } from "typebox"
import { Value } from "typebox/value"

/**
 * @typedef {import("node:http").IncomingMessage} IncomingMessage
 * @typedef {import("node:http").ServerResponse} ServerResponse
 * @typedef {import("../types").Project} Project
 * @typedef {import("../types").AgentStatus} AgentStatus
 * @typedef {import("../types").TakesSnapshot} TakesSnapshot
 * @typedef {import("./config.js").Connection} Connection
 * @typedef {import("../takes/store.js").TakeStore} TakeStore
 */

const MAX_BODY = 64 * 1024
const MAX_PROMPT = 8_000
/** The most takes one prompt starts. The chrome offers the same. */
const MAX_TAKES = 4
const applySchema = Type.Object({ revision: Type.String({ minLength: 1 }), behaviorReviewed: Type.Literal(true) }, { additionalProperties: false })

/**
 * The takes API on the dev server, under `/__caliper/takes`. The chrome
 * starts, prompts, stops, accepts and discards takes here, and hears about
 * every change on the event stream.
 *
 * @param {{
 *   store: TakeStore,
 *   status: AgentStatus,
 *   connection: Connection | null,
 *   project: () => Promise<Project>,
 *   serverUrl: () => string | null,
 *   chromium: string | undefined,
 *   onChange: () => void,
 * }} input
 */
export function createTakesApi({ store, status, connection, project, serverUrl, chromium, onChange }) {
  const renderDir = mkdtempSync(join(tmpdir(), "caliper-takes-"))
  const engine = () => {
    if (connection === null) throw new Error(status._tag === "Failed" ? `${status.reason} ${status.hint}` : "The agent is off. Add agent: { model } to caliper() in vite.config.")
    return connectEngine(connection)
  }

  /**
   * Render a part, as a take changes it or as the real files are.
   *
   * @param {string} part
   * @param {{ state: string, devices: string[], take?: string }} request
   */
  const renderPart = async (part, { state, devices, take }) => {
    const original = await project()
    const viewed = take === undefined ? original : { ...original, parts: takeParts(store, take, original.parts) }
    const plan = planRenders(viewed, { part, state, devices, ...(take === undefined ? {} : { take }) })
    if (plan._tag === "Invalid") throw new Error(plan.reason)
    if (!chromium) throw new Error("Caliper cannot render: set CHROMIUM to a Chromium executable in the shell that starts Vite, or in .env.local.")
    const url = serverUrl()
    if (url === null) throw new Error("The dev server is not listening yet.")
    return renderJobs({ url, jobs: plan.jobs, out: join(renderDir, take === undefined ? "real" : `take-${take}`), executablePath: chromium })
  }

  const agents = createTakeAgents({
    store,
    engine,
    renderFor: (take, ask) => request => renderPart(request.part ?? ask.part, { ...request, take }),
    onChange,
  })

  /** Checks hold a take still until they finish, including follow-up and discard. */
  const checking = new Set()

  /** @param {string} take */
  const checkIntegration = async take => {
    agents.assertIdle(take)
    checking.add(take)
    onChange()
    try {
      return await agents.integration.check(take, async () => {
        const original = await project()
        const proposal = agents.integration.review(take).proposal
        if (original.parts.find(part => part.file === proposal.preview.part)?.states.some(state => state.export === proposal.preview.state)) {
          throw new Error("The alternate needs a new named state or part that opts into the new choice. Existing states must stay unchanged.")
        }
        if (!chromium) throw new Error("Set CHROMIUM before checking an integration.")
        const url = serverUrl()
        if (!url) throw new Error("The dev server is not listening yet.")
        const jobs = original.parts.flatMap(part => part.states.flatMap(state => DEVICES.map(device => ({ part: part.file, state: state.export, device: device.id }))))
        const originals = () => renderJobs({ url, jobs, out: join(renderDir, `check-${take}-original`), executablePath: chromium })
        const proposed = () => renderJobs({ url, jobs: jobs.map(job => ({ ...job, take })), out: join(renderDir, `check-${take}-proposed`), executablePath: chromium })
        return verifyIntegration({ originals, proposed, alternate: () => renderPart(proposal.preview.part, { state: proposal.preview.state, devices: ["*"], take }) })
      })
    } finally {
      checking.delete(take)
      onChange()
    }
  }

  /**
   * Ask the planner for different directions for one prompt. It sees the
   * part's source and how the real part renders now.
   *
   * @param {unknown} body
   * @returns {Promise<import("../types").TakePlan>}
   */
  const plan = async body => {
    const ask = await validAsk(body)
    const count = /** @type {Record<string, unknown>} */ (body ?? {}).count
    if (typeof count !== "number" || !Number.isInteger(count) || count < 2 || count > MAX_TAKES) {
      throw new Error(`Ask the planner for 2 to ${MAX_TAKES} directions.`)
    }
    const connected = engine()
    /** @type {import("./planner.js").Content[]} */
    const context = [{ type: "text", text: `<file path="${ask.part}">\n${readFileSync(join(store.root, ask.part), "utf8")}\n</file>` }]
    try {
      const [result] = await renderPart(ask.part, { state: ask.state, devices: [ask.device] })
      if (result !== undefined) context.push({ type: "image", data: readFileSync(result.png).toString("base64"), mimeType: "image/png" })
    } catch (error) {
      context.push({ type: "text", text: `Caliper could not render the part: ${error instanceof Error ? error.message : String(error)}` })
    }
    return planDirections({ engine: connected, prompt: ask.prompt, count, part: ask.part, state: ask.state, device: ask.device, context })
  }

  /** @returns {TakesSnapshot} */
  const snapshot = () => ({ agent: status, takes: agents.views() })

  /**
   * @param {string} path below `/__caliper`
   * @param {IncomingMessage} request
   * @param {ServerResponse} response
   * @returns {Promise<boolean>} false when the path is not the API's
   */
  const handle = async (path, request, response) => {
    if (path === "/takes.json") {
      json(response, 200, snapshot())
      return true
    }
    if (path !== "/takes" && !path.startsWith("/takes/")) return false
    const refusal = refuse(request)
    if (refusal !== null) {
      json(response, 403, { error: refusal })
      return true
    }
    try {
      const body = await readJson(request)
      if (path === "/takes") {
        const ask = await validAsk(body)
        json(response, 201, { take: agents.start({ ...ask, ...validDirection(body) }) })
        return true
      }
      if (path === "/takes/plan") {
        json(response, 200, await plan(body))
        return true
      }
      const [, , take = "", action = ""] = path.split("/")
      if (!isTakeId(take) || store.record(take) === null) {
        json(response, 404, { error: `Take ${take} does not exist.` })
        return true
      }
      if (checking.has(take)) throw new Error("This integration is being checked. Wait before changing it.")
      if (action === "alternate") {
        json(response, 201, { take: agents.alternate(take) })
      } else if (action === "review") {
        agents.assertIdle(take)
        json(response, 200, agents.integration.review(take))
      } else if (action === "check") {
        json(response, 200, await checkIntegration(take))
      } else if (action === "apply") {
        agents.assertIdle(take)
        if (!Value.Check(applySchema, body)) throw new Error("Apply needs the reviewed revision and confirmation of product checks.")
        const files = agents.apply(take, body.revision, body.behaviorReviewed)
        json(response, 200, { take, files })
      } else if (action === "prompt") {
        agents.follow(take, validPrompt(body))
        json(response, 200, { take })
      } else if (action === "stop") {
        agents.stop(take)
        json(response, 200, { take })
      } else if (action === "accept") {
        json(response, 200, { take, files: agents.accept(take) })
      } else if (action === "discard") {
        agents.discard(take)
        json(response, 200, { take })
      } else {
        json(response, 404, { error: `Takes have no action "${action}".` })
      }
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : String(error) })
    }
    return true
  }

  /** @param {unknown} body */
  const validAsk = async body => {
    const { part, state, device } = /** @type {Record<string, unknown>} */ (body ?? {})
    const prompt = validPrompt(body)
    const known = (await project()).parts.find(candidate => candidate.file === part)
    if (known === undefined) throw new Error(`"${part}" is not a part.`)
    const stateName = typeof state === "string" ? state : "default"
    if (!known.states.some(candidate => candidate.export === stateName)) throw new Error(`${known.file} has no state "${stateName}".`)
    const deviceId = typeof device === "string" ? device : DEVICES[0]?.id ?? ""
    if (!DEVICES.some(candidate => candidate.id === deviceId)) throw new Error(`Caliper has no device "${deviceId}".`)
    return { part: known.file, state: stateName, device: deviceId, prompt }
  }

  return { handle, snapshot }
}

/**
 * Only the chrome may change takes. A write needs a POST with a JSON body,
 * which a page on another site cannot send without a CORS preflight, and an
 * Origin, when the browser sends one, of the dev server itself.
 *
 * @param {IncomingMessage} request
 * @returns {string | null}
 */
function refuse(request) {
  if (request.method !== "POST") return "Use POST."
  if (!(request.headers["content-type"] ?? "").startsWith("application/json")) return "Send a JSON body."
  const origin = request.headers.origin
  if (origin !== undefined && origin !== "null") {
    const host = request.headers.host
    if (host === undefined || new URL(origin).host !== host) return "Only Caliper's own page can change takes."
  }
  return null
}

/**
 * The direction a new take follows, and the titles its siblings follow, when
 * the chrome started it from a plan.
 *
 * @param {unknown} body
 * @returns {{ direction?: import("../types").Direction, others?: string[] }}
 */
function validDirection(body) {
  const { direction, others } = /** @type {Record<string, any>} */ (body ?? {})
  if (direction === undefined) return {}
  const title = typeof direction?.title === "string" ? direction.title.trim() : ""
  const brief = typeof direction?.brief === "string" ? direction.brief.trim() : ""
  if (title === "" || brief === "") throw new Error("A direction needs a title and a brief.")
  if (title.length > 80 || brief.length > MAX_PROMPT) throw new Error("The direction is too long.")
  const siblings = Array.isArray(others) ? others.filter(other => typeof other === "string" && other.trim() !== "").map(other => other.trim().slice(0, 80)).slice(0, MAX_TAKES) : []
  return { direction: { title, brief }, others: siblings }
}

/** @param {unknown} body */
function validPrompt(body) {
  const prompt = /** @type {Record<string, unknown>} */ (body ?? {}).prompt
  if (typeof prompt !== "string" || prompt.trim() === "") throw new Error("The prompt is empty.")
  if (prompt.length > MAX_PROMPT) throw new Error(`The prompt is longer than ${MAX_PROMPT} characters.`)
  return prompt.trim()
}

/**
 * @param {IncomingMessage} request
 * @returns {Promise<unknown>}
 */
async function readJson(request) {
  let size = 0
  /** @type {Buffer[]} */
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error("The request body is too large.")
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString("utf8")
  if (text.trim() === "") return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new Error("The request body is not JSON.")
  }
}

/**
 * @param {ServerResponse} response
 * @param {number} status
 * @param {unknown} body
 */
function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
  response.end(JSON.stringify(body))
}
