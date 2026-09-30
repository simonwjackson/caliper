#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 --command node
// @ts-check
// Spike only. The central app's routing: one port, the chrome under /__caliper/,
// each project under /__caliper/p/<id>/, and each HMR socket at /__caliper/hmr/<id>.
// It knows each project's port only from the registry, at request time.
import { readFileSync, readdirSync, rmSync } from "node:fs"
import { createServer, request as httpRequest } from "node:http"
import { connect } from "node:net"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"])

/**
 * @typedef {{ protocol: number, pid: number, id: string, root: string, name: string, url: string, started: string }} Entry
 */

/** @param {string} registry @returns {Entry[]} live entries; dead ones are deleted */
export function readRegistry(registry) {
  /** @type {Entry[]} */
  const live = []
  let names = []
  try { names = readdirSync(registry) } catch { return live }
  for (const name of names.filter(file => file.endsWith(".json"))) {
    const file = join(registry, name)
    try {
      const entry = /** @type {Entry} */ (JSON.parse(readFileSync(file, "utf8")))
      try { process.kill(entry.pid, 0) } catch { rmSync(file, { force: true }); continue }
      live.push(entry)
    } catch { /* a file mid-write or broken: skip it this time */ }
  }
  return live
}

/**
 * @param {{ port: number, registry: string, host?: string }} options
 * @returns {Promise<{ url: string, misses: string[], close: () => Promise<void> }>}
 */
export function startCentral({ port, registry, host = "127.0.0.1" }) {
  /** Paths that reached the central app with no project: requests the service worker did not route. */
  /** @type {string[]} */
  const misses = []
  /** @param {string} id */
  const find = id => readRegistry(registry).find(entry => entry.id === id)

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://central.local")
    const path = url.pathname
    if (path === "/" || path === "/__caliper") { res.writeHead(302, { location: "/__caliper/" }); return res.end() }
    if (path === "/__caliper/") return file(res, "chrome.html", "text/html")
    // Scope "/": a worker's script URL, such as /src/echo.worker.ts, sits outside /__caliper/.
    if (path === "/__caliper/sw.js") return file(res, "sw.js", "text/javascript", { "service-worker-allowed": "/" })
    if (path === "/__caliper/api/projects") return json(res, readRegistry(registry).map(({ id, name, root, url }) => ({ id, name, root, url })))
    if (path === "/__caliper/api/misses") return json(res, misses)
    const routed = path.match(/^\/__caliper\/p\/([0-9a-f]{12})(\/.*)$/)
    if (routed) {
      const [, id, rest] = /** @type {[string, string, string]} */ (routed)
      const entry = find(id)
      if (!entry) { res.writeHead(502, { "content-type": "text/plain" }); return res.end(`No running project has id ${id}. Start its dev server.`) }
      return forward(req, res, entry, `${rest}${url.search}`, `/__caliper/p/${id}`)
    }
    misses.push(path)
    res.writeHead(404, { "content-type": "text/plain" })
    res.end(`No project owns ${path}. The service worker did not route this request.`)
  })

  server.on("upgrade", (req, socket, head) => {
    const match = (req.url ?? "").match(/^\/__caliper\/hmr\/([0-9a-f]{12})(?:\?|$)/)
    const entry = match ? find(/** @type {string} */ (match[1])) : undefined
    if (!entry) { socket.end("HTTP/1.1 404 Not Found\r\n\r\n"); return }
    const target = new URL(entry.url)
    const upstream = connect(Number(target.port), target.hostname, () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`]
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = /** @type {string} */ (req.rawHeaders[i])
        lines.push(`${name}: ${name.toLowerCase() === "host" ? target.host : req.rawHeaders[i + 1]}`)
      }
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`)
      if (head.length) upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
    upstream.on("error", () => socket.destroy())
    socket.on("error", () => upstream.destroy())
  })

  return new Promise(ready => server.listen(port, host, () => {
    const address = /** @type {import("node:net").AddressInfo} */ (server.address())
    ready({
      url: `http://${host}:${address.port}/`, misses,
      close: () => new Promise(done => { server.closeAllConnections(); server.close(() => done()) }),
    })
  }))
}

/**
 * @param {import("node:http").IncomingMessage} req @param {import("node:http").ServerResponse} res
 * @param {Entry} entry @param {string} path @param {string} prefix
 */
function forward(req, res, entry, path, prefix) {
  const target = new URL(entry.url)
  /** @type {Record<string, string | string[]>} */
  const headers = {}
  for (const [name, value] of Object.entries(req.headers)) if (value !== undefined && !HOP.has(name)) headers[name] = value
  headers.host = target.host
  const upstream = httpRequest({ host: target.hostname, port: target.port, method: req.method, path, headers }, response => {
    /** @type {Record<string, string | string[]>} */
    const out = {}
    for (const [name, value] of Object.entries(response.headers)) if (value !== undefined && !HOP.has(name)) out[name] = value
    const location = response.headers.location
    if (typeof location === "string" && location.startsWith("/")) out.location = `${prefix}${location}`
    res.writeHead(response.statusCode ?? 502, out)
    response.pipe(res)
  })
  upstream.on("error", error => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" })
    res.end(`The dev server for ${entry.name} did not answer: ${error.message}`)
  })
  req.pipe(upstream)
}

/** @param {import("node:http").ServerResponse} res @param {string} name @param {string} type @param {Record<string, string>} [extra] */
function file(res, name, type, extra = {}) {
  res.writeHead(200, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store", ...extra })
  res.end(readFileSync(join(here, name)))
}

/** @param {import("node:http").ServerResponse} res @param {unknown} value */
function json(res, value) {
  res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
  res.end(JSON.stringify(value))
}
