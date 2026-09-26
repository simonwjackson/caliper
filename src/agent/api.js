// @ts-check
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEVICES } from "../client/device-frame.js"
import { planRenders } from "../render/plan.js"
import { renderJobs } from "../render/render.js"
import { isTakeId } from "../takes/store.js"
import { connectEngine } from "./model.js"
import { createTakeAgents } from "./take-agents.js"

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
  const agents = createTakeAgents({
    store,
    engine: () => {
      if (connection === null) throw new Error(status._tag === "Failed" ? `${status.reason} ${status.hint}` : "The agent is off. Add agent: { model } to caliper() in vite.config.")
      return connectEngine(connection)
    },
    renderFor: (take, ask) => async ({ state, devices }) => {
      const plan = planRenders(await project(), { part: ask.part, state, devices, take })
      if (plan._tag === "Invalid") throw new Error(plan.reason)
      if (!chromium) throw new Error("Caliper cannot render: set CHROMIUM to a Chromium executable in the shell that starts Vite, or in .env.local.")
      const url = serverUrl()
      if (url === null) throw new Error("The dev server has no local URL yet.")
      return renderJobs({ url, jobs: plan.jobs, out: join(renderDir, `take-${take}`), executablePath: chromium })
    },
    onChange,
  })

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
        json(response, 201, { take: agents.start(ask) })
        return true
      }
      const [, , take = "", action = ""] = path.split("/")
      if (!isTakeId(take) || store.record(take) === null) {
        json(response, 404, { error: `Take ${take} does not exist.` })
        return true
      }
      if (action === "prompt") {
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
