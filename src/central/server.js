// @ts-check
// The Caliper app (decision 37): one port for the chrome and every project.
//
//   /__caliper/                    the project list
//   /__caliper/p/<id>/<path>       <path> on the project's dev server; the
//                                  chrome is <base>__caliper/ under it
//   <base>__caliper/hmr/<id>       the project's Vite HMR socket
//   /__caliper/sw.js               the routing service worker
//   /__caliper/assets/, api/       the chrome's bundle and the app's own API
//
// It never starts or configures a project. It routes to dev servers that
// announce themselves in the registry, and runs every project's take agents.
import { mkdirSync, readFileSync } from "node:fs"
import { createServer, request as httpRequest } from "node:http"
import { connect } from "node:net"
import { homedir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromeDelivery } from "../build/chrome.js"
import { chromePage } from "../pages.js"
import { createAgentHosts } from "./agents.js"
import { resolveAgent } from "../agent/config.js"
import { readSettings, settingsFile, writeModel } from "./config.js"
import { modelChoices, piFavorites } from "./models.js"
import { homePage } from "./home.js"
import { PROTOCOL, registryDir } from "./registry.js"
import { createServerCheck, pluginUrl } from "./servers.js"

const PWA_DIR = fileURLToPath(new URL("../pwa/", import.meta.url))
const SERVICE_WORKER = fileURLToPath(new URL("./sw.js", import.meta.url))
const PWA_FILES = new Map([
  ["manifest.webmanifest", "application/manifest+json"],
  ["favicon.svg", "image/svg+xml"],
  ["favicon-16.png", "image/png"],
  ["favicon-32.png", "image/png"],
  ["apple-touch-icon.png", "image/png"],
  ["icon-192.png", "image/png"],
  ["icon-512.png", "image/png"],
  ["icon-maskable-192.png", "image/png"],
  ["icon-maskable-512.png", "image/png"],
])
const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"])
/** Take and mark requests: the app's agent answers them, not the plugin. */
const AGENT_PATHS = /^\/(?:takes(?:\.json|\/.*)?|marks(?:\.json|\/.*)?)$/
/** Knob writes into a take are edits by hand; the take's agent must be idle. */
const KNOB_WRITES = new Set(["/knobs/write", "/knobs/promote"])
const PROJECTS_POLL_MS = 1000

/**
 * @typedef {import("./registry.js").Entry} Entry
 * @typedef {import("./servers.js").Seen} Seen
 * @typedef {{ id: string, name: string, root: string, url: string, base: string, chrome: string, protocol: number, status: "Ready" | "Protocol" | "Duplicate" | "Silent", problem?: string }} ProjectView
 */

/**
 * The projects in the registry, as the chrome shows them. A project that
 * cannot be routed carries the reason.
 *
 * @param {Seen[]} entries
 * @returns {ProjectView[]}
 */
export function projectViews(entries) {
  /** @type {Map<string, number>} */
  const count = new Map()
  for (const entry of entries) count.set(entry.id, (count.get(entry.id) ?? 0) + 1)
  /** @type {Set<string>} */
  const shown = new Set()
  return entries.flatMap(/** @returns {ProjectView[]} */ entry => {
    if (shown.has(entry.id)) return []
    shown.add(entry.id)
    const base = { id: entry.id, name: entry.name, root: entry.root, url: entry.url, base: entry.base, chrome: `/__caliper/p/${entry.id}${slashBase(entry.base)}__caliper/`, protocol: entry.protocol }
    if ((count.get(entry.id) ?? 0) > 1) return [{ ...base, status: /** @type {const} */ ("Duplicate"), problem: `${count.get(entry.id)} dev servers serve it; stop all but one` }]
    if (entry.protocol !== PROTOCOL) return [{ ...base, status: /** @type {const} */ ("Protocol"), problem: `protocol ${entry.protocol}, this app speaks ${PROTOCOL}` }]
    if (entry.silent !== undefined) return [{ ...base, status: /** @type {const} */ ("Silent"), problem: `its dev server is not answering: ${entry.silent}` }]
    return [{ ...base, status: /** @type {const} */ ("Ready") }]
  }).sort((left, right) => left.name.localeCompare(right.name) || left.root.localeCompare(right.root))
}

/** @param {string} base Vite's base, such as "/" or "/app/" */
const slashBase = base => base.replace(/\/?$/, "/").replace(/^\/?/, "/")

/**
 * @param {{
 *   port?: number, host?: string, registry?: string, stateDir?: string,
 *   settings?: string, agent?: import("../types").AgentOptions,
 *   env?: Record<string, string | undefined>,
 * }} [options]
 *   `agent` replaces the settings file's agent, for tests and scripts.
 * @returns {Promise<{ url: string, port: number, projectUrl: (id: string) => Promise<string | null>, close: () => Promise<void>, misses: string[] }>}
 */
export async function startCentral(options = {}) {
  const env = options.env ?? process.env
  const registry = options.registry ?? registryDir(env)
  const stateDir = options.stateDir ?? join(env.XDG_STATE_HOME || join(homedir(), ".local/state"), "caliper")
  mkdirSync(stateDir, { recursive: true })
  const settings = options.settings ?? settingsFile(env)
  // Fail at start on a broken settings file, rather than ignore it.
  const initial = readSettings(settings)
  // Tests and scripts give the agent directly; choosing a model then changes only this copy.
  const overridden = "agent" in options
  let override = options.agent
  const agentOption = () => overridden ? override : readSettings(settings).agent ?? initial.agent
  /** Requests with no project: a service worker that did not route them. */
  /** @type {string[]} */
  const misses = []

  const servers = createServerCheck({ registry })
  /** @returns {Promise<Seen[]>} */
  const entries = () => servers.list()
  /**
   * The one routable entry for a project id: one server, this protocol, and it answers.
   *
   * @param {string} id
   * @returns {Promise<Entry | null>}
   */
  const routable = async id => {
    const found = (await entries()).filter(entry => entry.id === id)
    const only = found.length === 1 ? found[0] : undefined
    return only !== undefined && only.protocol === PROTOCOL && only.silent === undefined ? only : null
  }

  const hosts = createAgentHosts({
    stateDir, agent: agentOption, env,
    hostCall: async (id, target, method, args, signal) => {
      const entry = await routable(id)
      // The agent's worker asks where the project's server is now; it can restart on another port.
      if (target === "app" && method === "server") return entry === null ? { error: "The project's dev server is not running, or cannot be routed. Start it and try again." } : { value: { url: entry.url, base: entry.base } }
      if (entry === null) return { error: "The project's dev server is not running, or cannot be routed. Start it and try again." }
      signal.throwIfAborted()
      const response = await pluginFetch(entry, "host", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target, method, args }), signal })
      const reply = /** @type {Record<string, unknown>} */ (await response.json().catch(() => ({ error: `The dev server answered ${response.status}.` })))
      if (!response.ok && reply.error === undefined) return { error: `The dev server answered ${response.status}.` }
      return reply
    },
  })

  /** @param {Entry} entry @param {string} path below `<base>__caliper/` @param {RequestInit} [init] */
  const pluginFetch = (entry, path, init = {}) => {
    const headers = new Headers(init.headers)
    headers.set("authorization", `Bearer ${entry.token}`)
    return fetch(pluginUrl(entry, path), { ...init, headers })
  }

  const themeColor = JSON.parse(readFileSync(join(PWA_DIR, "manifest.webmanifest"), "utf8")).theme_color
  const chromeHtml = () => {
    const delivery = chromeDelivery()
    return chromePage({
      entryUrl: `/__caliper/assets/${delivery.entry}`, cssUrls: delivery.css.map(file => `/__caliper/assets/${file}`),
      pwaUrl: "/__caliper", themeColor, serviceWorker: "/__caliper/sw.js",
    })
  }

  const server = createServer((request, response) => {
    void handle(request, response).catch(error => {
      if (!response.headersSent) sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
      else response.destroy()
    })
  })

  /**
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   */
  const handle = async (request, response) => {
    const url = new URL(request.url ?? "/", "http://caliper.local")
    const path = url.pathname
    // Browsers send Origin on every cross-site write. Only the app's own pages write.
    // This is the only origin check: the plugin and the agent trust what passes it (decision 37).
    if (request.method !== "GET" && request.method !== "HEAD" && !sameOrigin(request)) {
      return sendJson(response, 403, { error: "Only the Caliper app's own page can change files and takes." })
    }
    if (path === "/" || path === "/__caliper") return redirect(response, "/__caliper/")
    if (path === "/__caliper/") return send(response, 200, "text/html", homePage({ themeColor }))
    if (path === "/__caliper/sw.js") {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store", "service-worker-allowed": "/" })
      return response.end(readFileSync(SERVICE_WORKER))
    }
    if (path === "/__caliper/api/projects") return sendJson(response, 200, { protocol: PROTOCOL, projects: projectViews(await entries()) })
    if (path === "/__caliper/api/projects/events") return projectEvents(response)
    if (path.startsWith("/__caliper/assets/")) return sendAsset(response, path.slice("/__caliper/assets/".length))
    const pwaType = PWA_FILES.get(path.slice("/__caliper/".length))
    if (path.startsWith("/__caliper/") && pwaType !== undefined) {
      response.writeHead(200, { "content-type": pwaType, "cache-control": "no-store" })
      return response.end(readFileSync(join(PWA_DIR, path.slice("/__caliper/".length))))
    }
    const routed = /^\/__caliper\/p\/([0-9a-f]{12})(\/.*)$/.exec(path)
    if (routed === null) {
      misses.push(path)
      return send(response, 404, "text/plain", `No project owns ${path}. Open a project from /__caliper/, and reload the page if it was a hard reload.`)
    }
    const id = /** @type {string} */ (routed[1])
    const inner = /** @type {string} */ (routed[2])
    const entry = await routable(id)
    if (entry === null) {
      const view = projectViews(await entries()).find(project => project.id === id)
      return sendJson(response, 502, { error: view?.problem ?? `No running dev server has project ${id}. Start its dev server; the page reconnects when it is up.` })
    }
    const caliper = `${slashBase(entry.base)}__caliper`
    if (inner === caliper) return redirect(response, `/__caliper/p/${id}${caliper}/${url.search}`)
    if (inner === `${caliper}/`) {
      try { return send(response, 200, "text/html", chromeHtml()) }
      catch (error) { return send(response, 503, "text/plain", error instanceof Error ? error.message : String(error)) }
    }
    if (inner.startsWith(`${caliper}/`)) {
      const below = inner.slice(caliper.length)
      if (AGENT_PATHS.test(below)) return toAgent(request, response, entry, below)
      // The model is app-wide; the chrome asks under its project's path, as for everything else.
      if (below === "/models.json" && request.method === "GET") return sendModels(response)
      if (below === "/model" && request.method === "POST") return chooseModel(request, response)
      if (below === "/events") return events(request, response, entry)
      if (KNOB_WRITES.has(below) && request.method === "POST") return knobWrite(request, response, entry, `${inner}${url.search}`)
    }
    return forward(request, response, entry, `${inner}${url.search}`)
  }

  /**
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   * @param {Entry} entry
   * @param {string} below the path under `__caliper`
   */
  const toAgent = async (request, response, entry, below) => {
    const body = await readBody(request)
    const headers = /** @type {Record<string, string>} */ ({})
    for (const [name, value] of Object.entries(request.headers)) if (typeof value === "string") headers[name] = value
    const answer = await hosts.get(entry.id, entry.root).request({ path: below, method: request.method ?? "GET", headers, body })
    response.writeHead(answer.status, answer.headers)
    response.end(answer.body)
  }

  /**
   * The picker's choices: the endpoint's models, with pi's scoped models as
   * favorites (decision 43).
   *
   * @param {import("node:http").ServerResponse} response
   */
  const sendModels = async response => {
    const { status, connection } = resolveAgent({ option: agentOption(), env })
    if (connection === null) return sendJson(response, 409, { error: status._tag === "Failed" ? `${status.reason} ${status.hint}` : status._tag === "Off" ? status.hint : "The agent has no connection." })
    return sendJson(response, 200, await modelChoices({ current: connection.model, connection, patterns: piFavorites(env, homedir()) }))
  }

  /**
   * Choose the agent's model for every project. Takes and plans that start
   * after it use the new model; a running take keeps its own.
   *
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   */
  const chooseModel = async (request, response) => {
    /** @type {unknown} */
    let model
    try { model = JSON.parse((await readBody(request)).toString("utf8"))?.model } catch { /* refused below */ }
    if (typeof model !== "string" || !/^\S{1,200}$/.test(model)) return sendJson(response, 400, { error: "Send { \"model\": \"<model id>\" }, an id with no spaces." })
    if (overridden) {
      if (override === undefined) return sendJson(response, 409, { error: "The agent is off, so it has no model to change." })
      override = { ...override, model }
    } else {
      try { writeModel(settings, model) }
      catch (error) { return sendJson(response, 409, { error: error instanceof Error ? error.message : String(error) }) }
    }
    hosts.reconfigure()
    return sendModels(response)
  }

  /**
   * A knob's write into a take waits for the take's agent to be idle, as a
   * save from the code pane does; then the plugin writes it.
   *
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   * @param {Entry} entry
   * @param {string} path
   */
  const knobWrite = async (request, response, entry, path) => {
    const body = await readBody(request)
    /** @type {unknown} */
    let take
    try { take = JSON.parse(body.toString("utf8"))?.take } catch { /* the plugin reports a broken body */ }
    if (typeof take === "string") {
      const problem = await hosts.get(entry.id, entry.root).editable(take)
      if (problem !== null) return sendJson(response, 400, { error: problem })
    }
    return forward(request, response, entry, path, body)
  }

  /**
   * Proxy one request to the project's dev server. Writes get the server's token.
   *
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   * @param {Entry} entry
   * @param {string} path
   * @param {Buffer} [body] a body already read
   */
  const forward = (request, response, entry, path, body) => {
    const target = new URL(entry.url)
    /** @type {Record<string, string | string[]>} */
    const headers = {}
    for (const [name, value] of Object.entries(request.headers)) if (value !== undefined && !HOP.has(name)) headers[name] = value
    headers.host = target.host
    headers.authorization = `Bearer ${entry.token}`
    if (body !== undefined) headers["content-length"] = String(body.length)
    const upstream = httpRequest({ host: socketHost(target), port: target.port, method: request.method, path, headers }, answer => {
      /** @type {Record<string, string | string[]>} */
      const out = {}
      for (const [name, value] of Object.entries(answer.headers)) if (value !== undefined && !HOP.has(name)) out[name] = value
      const location = answer.headers.location
      if (typeof location === "string" && location.startsWith("/") && !location.startsWith("//")) out.location = `/__caliper/p/${entry.id}${location}`
      response.writeHead(answer.statusCode ?? 502, out)
      answer.pipe(response)
    })
    upstream.on("error", error => {
      if (!response.headersSent) sendJson(response, 502, { error: `The dev server for ${entry.name} did not answer: ${error.message}` })
      else response.destroy()
    })
    if (body !== undefined) upstream.end(body)
    else request.pipe(upstream)
  }

  /**
   * The chrome's event stream: the plugin's project, checks and code events,
   * with this app's takes and marks. A knob's edit reaches the take's agent.
   *
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   * @param {Entry} entry
   */
  const events = async (request, response, entry) => {
    const abort = new AbortController()
    request.on("close", () => abort.abort())
    /** @type {Response} */
    let upstream
    try { upstream = await pluginFetch(entry, "events", { signal: abort.signal }) }
    catch (error) { return sendJson(response, 502, { error: `The dev server for ${entry.name} did not answer: ${error instanceof Error ? error.message : String(error)}` }) }
    if (!upstream.ok || upstream.body === null) return sendJson(response, 502, { error: `The dev server for ${entry.name} answered ${upstream.status} for its events.` })
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" })
    const host = hosts.get(entry.id, entry.root)
    /** @param {string} name @param {unknown} data */
    const write = (name, data) => { if (!response.writableEnded) response.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`) }
    let started = false
    /** @type {Array<{ type: string, data: unknown }>} */
    const early = []
    const unsubscribe = host.subscribe(event => { if (started) write(event.type, event.data); else early.push(event) })
    const startAgent = async () => {
      const snapshot = await host.snapshot()
      if (snapshot.takes !== null) write("takes", snapshot.takes)
      if (snapshot.marks !== null) write("marks", snapshot.marks)
      started = true
      for (const event of early.splice(0)) write(event.type, event.data)
    }
    const decoder = new TextDecoder()
    let buffer = ""
    try {
      for await (const chunk of /** @type {AsyncIterable<Uint8Array>} */ (/** @type {unknown} */ (upstream.body))) {
        buffer += decoder.decode(chunk, { stream: true })
        for (let end = buffer.indexOf("\n\n"); end !== -1; end = buffer.indexOf("\n\n")) {
          const block = buffer.slice(0, end)
          buffer = buffer.slice(end + 2)
          const name = /^event: (.*)$/m.exec(block)?.[1] ?? "message"
          const data = block.split("\n").filter(line => line.startsWith("data: ")).map(line => line.slice(6)).join("\n")
          if (name === "edit") {
            try { const edit = JSON.parse(data); host.edit(edit.take, edit.file) } catch { /* not an edit */ }
            continue
          }
          if (!response.writableEnded) response.write(`${block}\n\n`)
          if (name === "project" && !started) await startAgent()
        }
      }
    } catch { /* the chrome closed the stream, or the dev server stopped */ }
    finally {
      unsubscribe()
      // The chrome's EventSource reconnects, to the server's new port if it restarted.
      if (!response.writableEnded) response.end()
    }
  }

  /** The project list, each time it changes. @param {import("node:http").ServerResponse} response */
  const projectEvents = response => {
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" })
    let last = ""
    let busy = false
    const tick = async () => {
      // A check can outlast the interval; one at a time keeps the events in order.
      if (busy) return
      busy = true
      try {
        const now = JSON.stringify({ protocol: PROTOCOL, projects: projectViews(await entries()) })
        if (now !== last && !response.writableEnded) response.write(`event: projects\ndata: ${now}\n\n`)
        last = now
      } finally { busy = false }
    }
    void tick()
    const timer = setInterval(() => void tick(), PROJECTS_POLL_MS)
    response.on("close", () => clearInterval(timer))
  }

  server.on("upgrade", async (request, socket, head) => {
    const match = /\/__caliper\/hmr\/([0-9a-f]{12})(?:\?|$)/.exec(request.url ?? "")
    // The check below waits; a socket that fails meanwhile must not throw.
    socket.on("error", () => socket.destroy())
    const entry = match ? await routable(/** @type {string} */ (match[1])) : null
    if (entry === null) { socket.end("HTTP/1.1 404 Not Found\r\n\r\n"); return }
    const target = new URL(entry.url)
    const upstream = connect(Number(target.port), socketHost(target), () => {
      const lines = [`${request.method} ${request.url} HTTP/1.1`]
      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        const name = /** @type {string} */ (request.rawHeaders[index])
        lines.push(`${name}: ${name.toLowerCase() === "host" ? target.host : request.rawHeaders[index + 1]}`)
      }
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`)
      if (head.length) upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
    upstream.on("error", () => socket.destroy())
    socket.on("error", () => upstream.destroy())
  })

  const host = options.host ?? "127.0.0.1"
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(options.port ?? 3132, host, () => resolve(undefined))
  })
  const address = /** @type {import("node:net").AddressInfo} */ (server.address())
  const origin = `http://${host.includes(":") ? `[${host}]` : host}:${address.port}`
  return {
    url: `${origin}/`,
    port: address.port,
    misses,
    /** The chrome's URL for a project, or null when no dev server can be routed for it. @param {string} id */
    projectUrl: async id => {
      const entry = await routable(id)
      return entry === null ? null : `${origin}/__caliper/p/${id}${slashBase(entry.base)}`
    },
    close: async () => {
      await hosts.close()
      server.closeAllConnections()
      await new Promise(done => server.close(() => done(undefined)))
    },
  }
}

/**
 * Whether a write comes from the app's own page. No Origin: not a browser
 * page on another site, such as a script or a test.
 *
 * @param {import("node:http").IncomingMessage} request
 */
function sameOrigin(request) {
  const origin = request.headers.origin
  if (origin === undefined) return true
  if (origin === "null") return false
  try {
    const host = new URL(origin).host
    const forwarded = request.headers["x-forwarded-host"]
    return host === request.headers.host || (typeof forwarded === "string" && forwarded.split(",").some(value => value.trim() === host))
  } catch { return false }
}

/** @param {import("node:http").IncomingMessage} request @returns {Promise<Buffer>} */
async function readBody(request) {
  /** @type {Buffer[]} */
  const chunks = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

/** @param {import("node:http").ServerResponse} response @param {string} file */
function sendAsset(response, file) {
  try {
    const served = chromeDelivery().read(file)
    if (served === null) return send(response, 404, "text/plain", "Caliper has no such chrome resource.")
    response.writeHead(200, { "content-type": `${served.type}; charset=utf-8`, "cache-control": "no-store" })
    return response.end(served.body)
  } catch (error) {
    return send(response, 503, "text/plain", error instanceof Error ? error.message : String(error))
  }
}

/** @param {import("node:http").ServerResponse} response @param {number} status @param {string} type @param {string} body */
function send(response, status, type, body) {
  response.writeHead(status, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store" })
  response.end(body)
}

/** @param {import("node:http").ServerResponse} response @param {number} status @param {unknown} body */
function sendJson(response, status, body) {
  send(response, status, "application/json", JSON.stringify(body))
}

/** @param {import("node:http").ServerResponse} response @param {string} location */
function redirect(response, location) {
  response.writeHead(302, { location })
  response.end()
}

/**
 * The host a socket connects to. A URL keeps an IPv6 address in brackets,
 * such as `[::1]` for a dev server that listens on localhost; a socket needs it bare.
 *
 * @param {URL} url
 */
export function socketHost(url) {
  return url.hostname.replace(/^\[(.*)\]$/, "$1")
}
