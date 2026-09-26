// @ts-check
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { isAbsolute, join, relative, resolve as resolvePath } from "node:path"
import { fileURLToPath } from "node:url"
import { deriveProject } from "./derive/project.js"
import { discoverParts, PART_SUFFIX } from "./derive/parts.js"
import { chromePage, framePage } from "./pages.js"

/**
 * @typedef {import("./types").CaliperOptions} CaliperOptions
 * @typedef {import("./types").Project} Project
 * @typedef {import("./types").FrameConfig} FrameConfig
 * @typedef {import("vite").Plugin} Plugin
 * @typedef {import("vite").ViteDevServer} ViteDevServer
 * @typedef {import("node:http").ServerResponse} ServerResponse
 */

/** Everything Caliper serves lives under this path on the project's dev server. */
export const CALIPER_PATH = "/__caliper"

const CLIENT_DIR = fileURLToPath(new URL("./client/", import.meta.url))
const CLIENT_FILES = new Map([
  ["chrome.js", "text/javascript"],
  ["chrome.css", "text/css"],
  ["device-frame.js", "text/javascript"],
  ["frame.js", "text/javascript"],
  ["frame.css", "text/css"],
])
const REACT_MODULE = "virtual:caliper/react"
const RESOLVED_REACT_MODULE = "\0caliper:react"
/** The project's React packages the frame loads, pre-bundled so the first load does not reload. */
const REACT_PACKAGES = ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"]
const REFRESH_DELAY_MS = 80

/**
 * Caliper: see the project's own UI parts at true physical device size.
 *
 * Add it to the project's vite.config and open `/__caliper/` on the dev
 * server. It runs only under `vite dev`, never in a build.
 *
 * @param {CaliperOptions} [options] overrides, only for when a derivation fails
 * @returns {Plugin}
 */
export function caliper(options = {}) {
  /** @type {string} */
  let root = process.cwd()

  return {
    name: "caliper",
    apply: "serve",

    config(userConfig) {
      root = resolvePath(userConfig.root ?? process.cwd())
      const parts = discoverParts(root).map(part => part.file)
      const require = createRequire(join(root, "package.json"))
      const react = REACT_PACKAGES.filter(name => canResolve(require, name))
      return {
        optimizeDeps: {
          entries: parts,
          include: react,
        },
      }
    },

    configResolved(config) {
      root = config.root
    },

    resolveId(id) {
      if (id === REACT_MODULE) return RESOLVED_REACT_MODULE
      // Vite pre-transforms the frame page's script. Point it at the real file,
      // although Caliper's middleware serves the request itself.
      const client = clientFile(id)
      return client === null ? null : join(CLIENT_DIR, client)
    },

    load(id) {
      // Caliper's own folder is outside the project's fs.allow, so read it here.
      if (id.startsWith(CLIENT_DIR)) return readFileSync(id, "utf8")
      if (id !== RESOLVED_REACT_MODULE) return null
      return [
        'export { createElement } from "react"',
        'export { createRoot } from "react-dom/client"',
      ].join("\n")
    },

    configureServer(server) {
      const session = createSession(server, root, options)
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? "/", "http://caliper.local")
        if (url.pathname !== CALIPER_PATH && !url.pathname.startsWith(`${CALIPER_PATH}/`)) return next()
        session.handle(url, response).catch(next)
      })

      const printUrls = server.printUrls.bind(server)
      server.printUrls = () => {
        printUrls()
        for (const url of server.resolvedUrls?.local ?? []) {
          server.config.logger.info(`  \u279c  Caliper: ${new URL(`${CALIPER_PATH.slice(1)}/`, url).href}`)
        }
      }
    },
  }
}

/**
 * The per-server state: the derived project, the open event streams, and the
 * file watching that keeps both current.
 *
 * @param {ViteDevServer} server
 * @param {string} root
 * @param {CaliperOptions} options
 */
function createSession(server, root, options) {
  /** @type {Promise<{ project: Project, json: string, files: Set<string> }> | null} */
  let current = null
  /** @type {Set<ServerResponse>} */
  const streams = new Set()
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let refreshTimer

  /** @param {string} specifier @param {string} importer */
  const resolve = async (specifier, importer) => {
    const container = server.environments?.client?.pluginContainer ?? server.pluginContainer
    const result = await container.resolveId(specifier, importer)
    if (!result || result.external) return null
    const id = result.id.split("?")[0] ?? ""
    return isAbsolute(id) && existsSync(id) ? id : null
  }

  const load = () => {
    current ??= deriveProject({ root, options, resolve }).then(({ project, files }) => ({
      project,
      json: JSON.stringify(project),
      files: new Set(files),
    }))
    return current
  }

  /** Derive again, and tell every open chrome when the result changed. */
  const refresh = () => {
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(async () => {
      const before = current ? (await current).json : null
      current = null
      const after = (await load()).json
      if (after === before) return
      for (const stream of streams) stream.write(`event: project\ndata: ${after}\n\n`)
    }, REFRESH_DELAY_MS)
  }

  /** @param {string} file */
  const affects = async file => {
    if (file.endsWith(PART_SUFFIX)) return true
    return current !== null && (await current).files.has(file)
  }
  server.watcher.on("change", file => { void affects(file).then(yes => yes && refresh()) })
  // A new or removed file can be a part, or can satisfy an import that did not resolve before.
  server.watcher.on("add", file => { if (!file.includes("/node_modules/")) refresh() })
  server.watcher.on("unlink", file => { if (!file.includes("/node_modules/")) refresh() })

  const base = server.config.base.replace(/\/$/, "")

  /** @param {string} file root-relative */
  const fileUrl = file => {
    const absolute = resolvePath(root, file)
    const inside = relative(root, absolute)
    return inside.startsWith("..") ? `${base}/@fs${absolute}` : `${base}/${inside.replaceAll("\\", "/")}`
  }

  /**
   * @param {URL} url
   * @param {ServerResponse} response
   */
  const handle = async (url, response) => {
    const path = url.pathname.slice(CALIPER_PATH.length)
    if (path === "") return redirect(response, `${base}${CALIPER_PATH}/`)
    if (path === "/") return send(response, 200, "text/html", chromePage({ clientUrl: `${base}${CALIPER_PATH}/client` }))
    if (path === "/project.json") return send(response, 200, "application/json", (await load()).json)
    if (path === "/events") return openStream(response, (await load()).json)
    if (path === "/frame") return sendFrame(url.searchParams.get("part") ?? "", url.searchParams.get("state") ?? "default", response)
    if (path.startsWith("/client/")) return sendClientFile(path.slice("/client/".length), response)
    return send(response, 404, "text/plain", `Caliper has no page at ${url.pathname}.`)
  }

  /**
   * @param {string} partFile
   * @param {string} stateName the export to render
   * @param {ServerResponse} response
   */
  const sendFrame = async (partFile, stateName, response) => {
    const { project } = await load()
    const part = project.parts.find(candidate => candidate.file === partFile)
    const problem = part === undefined
      ? `"${partFile}" is not a part of ${project.name}. Pick a part from the list.`
      : part.states.some(state => state.export === stateName)
        ? null
        : `${partFile} has no state "${stateName}". Its states are: ${part.states.map(state => state.export).join(", ")}.`
    const wrapper = project.wrapper._tag === "Failed" ? [] : project.wrapper.value.elements
    const css = project.css._tag === "Failed" ? [] : project.css.value.stylesheets.map(sheet => fileUrl(sheet.file))
    /** @type {FrameConfig} */
    const config = {
      part: fileUrl(partFile),
      partFile,
      state: stateName,
      css,
      wrapper,
      react: `${base}/@id/__x00__${RESOLVED_REACT_MODULE.slice(1)}`,
    }
    const frameUrl = `${CALIPER_PATH}/frame?part=${encodeURIComponent(partFile)}&state=${encodeURIComponent(stateName)}`
    const html = framePage({ clientUrl: `${base}${CALIPER_PATH}/client`, config, problem })
    send(response, problem === null ? 200 : 404, "text/html", await server.transformIndexHtml(frameUrl, html))
  }

  /**
   * @param {ServerResponse} response
   * @param {string} json
   */
  const openStream = (response, json) => {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    })
    response.write(`event: project\ndata: ${json}\n\n`)
    streams.add(response)
    response.on("close", () => streams.delete(response))
  }

  return { handle }
}

/**
 * The client file an id names, or null.
 *
 * @param {string} id
 */
function clientFile(id) {
  const prefix = `${CALIPER_PATH}/client/`
  if (!id.startsWith(prefix)) return null
  const name = id.slice(prefix.length)
  return CLIENT_FILES.has(name) ? name : null
}

/**
 * @param {string} name
 * @param {ServerResponse} response
 */
function sendClientFile(name, response) {
  const type = CLIENT_FILES.get(name)
  if (type === undefined) return send(response, 404, "text/plain", `Caliper has no client file ${name}.`)
  send(response, 200, type, readFileSync(join(CLIENT_DIR, name), "utf8"))
}

/**
 * @param {ServerResponse} response
 * @param {number} status
 * @param {string} type
 * @param {string} body
 */
function send(response, status, type, body) {
  response.writeHead(status, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store" })
  response.end(body)
}

/**
 * @param {ServerResponse} response
 * @param {string} location
 */
function redirect(response, location) {
  response.writeHead(302, { location })
  response.end()
}

/**
 * @param {NodeRequire} require
 * @param {string} name
 */
function canResolve(require, name) {
  try {
    require.resolve(name)
    return true
  } catch {
    return false
  }
}
