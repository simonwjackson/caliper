// @ts-check
// One project's take agents, in a worker thread of the Caliper app. The main
// thread forwards the chrome's take and mark requests here and relays the
// snapshots this worker posts. File access goes to the project's plugin.
import { Readable } from "node:stream"
import { join } from "node:path"
import { parentPort, workerData } from "node:worker_threads"
import { createTakesApi } from "../agent/api.js"
import { resolveAgent } from "../agent/config.js"
import { discoverSkills } from "../agent/skills.js"
import { remoteHost } from "./remote-host.js"
import { pluginUrl } from "./servers.js"
import { chromiumExecutable } from "../render/chromium.js"
import { syncCaller } from "./sync-call.js"

/**
 * @typedef {{
 *   id: string, root: string, stateDir: string, home: string,
 *   agent: import("../types").AgentOptions | undefined, env: Record<string, string | undefined>,
 *   port: import("node:worker_threads").MessagePort, flag: SharedArrayBuffer,
 * }} HostData
 */

const data = /** @type {HostData} */ (workerData)
const main = /** @type {import("node:worker_threads").MessagePort} */ (parentPort)
const TAKES_DELAY_MS = 100

const call = syncCaller({ port: data.port, flag: data.flag })
/**
 * The project's dev server now, as the app checked it; the server can
 * restart on another port, and a stale registry file must not lead here.
 *
 * @returns {{ url: string, base: string }}
 */
const entry = () => {
  const reply = call("app", "server", [])
  if (reply.error !== undefined) throw new Error(reply.error)
  return /** @type {{ url: string, base: string }} */ (reply.value)
}

const host = remoteHost({ call, root: data.root })
const agent = resolveAgent({ option: data.agent, env: data.env })

/** @type {ReturnType<typeof setTimeout> | undefined} */
let takesTimer
const takesChanged = () => {
  takesTimer ??= setTimeout(() => {
    takesTimer = undefined
    try { main.postMessage({ type: "takes", data: api.snapshot() }) } catch { /* the project is away; the next change reports again */ }
  }, TAKES_DELAY_MS)
}

const api = createTakesApi({
  store: host.store,
  status: agent.status,
  connection: agent.connection,
  project: async () => {
    const response = await fetch(pluginUrl(entry(), "project.json"))
    if (!response.ok) throw new Error(`The project's dev server answered ${response.status} for its parts.`)
    return response.json()
  },
  serverUrl: () => { try { return entry().url.replace(/\/$/, "") } catch { return null } },
  chromium: chromiumExecutable(data.env),
  onChange: takesChanged,
  onMarks: draft => main.postMessage({ type: "marks", data: draft }),
  skills: () => discoverSkills({ root: data.root, home: data.home, option: data.agent?.skills, project: host.projectSkills() }),
  host: {
    parts: host.parts,
    readFile: host.readFile,
    marks: host.marks,
    integration: host.integration,
    baselines: join(data.stateDir, "baselines", data.id),
  },
})

/**
 * A response the takes API writes into, for one forwarded request.
 */
class Reply {
  status = 200
  /** @type {Record<string, string>} */
  headers = {}
  /** @type {Buffer[]} */
  chunks = []
  /** @param {number} status @param {Record<string, string>} [headers] */
  writeHead(status, headers = {}) { this.status = status; Object.assign(this.headers, headers); return this }
  /** @param {string} name @param {string} value */
  setHeader(name, value) { this.headers[name] = value }
  /** @param {string | Uint8Array} [chunk] */
  write(chunk) { if (chunk !== undefined) this.chunks.push(Buffer.from(chunk)); return true }
  /** @param {string | Uint8Array} [chunk] */
  end(chunk) { this.write(chunk); return this }
}

main.on("message", async message => {
  if (message.type === "request") {
    const request = Object.assign(Readable.from(message.body.length ? [Buffer.from(message.body)] : []), { method: message.method, headers: message.headers, url: message.path })
    const reply = new Reply()
    try {
      const handled = await api.handle(message.path, /** @type {any} */ (request), /** @type {any} */ (reply))
      if (!handled) reply.writeHead(404, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify({ error: `Caliper has no page at ${message.path}.` }))
    } catch (error) {
      reply.writeHead(500, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    }
    main.postMessage({ type: "response", seq: message.seq, status: reply.status, headers: reply.headers, body: Buffer.concat(reply.chunks) })
  } else if (message.type === "snapshot") {
    /** @type {unknown} */
    let takes = null
    /** @type {unknown} */
    let marks = null
    /** @type {string | null} */
    let problem = null
    try { takes = api.snapshot() } catch (error) { problem = error instanceof Error ? error.message : String(error) }
    // A broken marks.json must not close the stream; the chrome reads the reason from marks.json.
    try { marks = api.marks() } catch { /* reported by marks.json */ }
    main.postMessage({ type: "snapshot", seq: message.seq, takes, marks, problem })
  } else if (message.type === "edit") {
    api.noteHandEdit(message.take, message.file)
  } else if (message.type === "editable") {
    /** @type {string | null} */
    let error = null
    try { api.assertEditable(message.take) } catch (reason) { error = reason instanceof Error ? reason.message : String(reason) }
    main.postMessage({ type: "editable", seq: message.seq, error })
  } else if (message.type === "close") {
    clearTimeout(takesTimer)
    await api.close()
    main.postMessage({ type: "closed" })
    process.exit(0)
  }
})
main.postMessage({ type: "ready" })
