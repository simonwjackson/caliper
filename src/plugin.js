// @ts-check
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { isAbsolute, join, relative, resolve as resolvePath } from "node:path"
import { fileURLToPath } from "node:url"
import { loadEnv } from "vite"
import { deriveProject } from "./derive/project.js"
import { discoverParts, PART_SUFFIX } from "./derive/parts.js"
import { createTakesApi } from "./agent/api.js"
import { listeningOrigin } from "./server-origin.js"
import { resolveAgent } from "./agent/config.js"
import { chromePage, framePage } from "./pages.js"
import { takeOf, takeOverlay, withTake } from "./takes/overlay.js"
import { createTakeStore, isTakeId, TAKES_DIR } from "./takes/store.js"

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
const TAKES_DELAY_MS = 100

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
  const overlay = takeOverlay(() => root)
  /** @type {Record<string, string | undefined>} */
  let env = { ...process.env }

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
      // The shell's environment wins over .env files, as in Vite itself.
      env = { ...loadEnv(config.mode, typeof config.envDir === "string" ? config.envDir : root, ""), ...process.env }
    },

    resolveId: {
      // Before vite:resolve, which would drop a take's tag from the import.
      order: "pre",
      async handler(id, importer, resolveOptions) {
        if (id === REACT_MODULE) return RESOLVED_REACT_MODULE
        const tagged = await overlay.resolveId.call(this, id, importer, resolveOptions)
        if (tagged) return tagged
        // Vite pre-transforms the frame page's script. Point it at the real file,
        // although Caliper's middleware serves the request itself.
        const client = clientFile(id)
        return client === null ? null : join(CLIENT_DIR, client)
      },
    },

    hotUpdate(update) {
      return overlay.hotUpdate.call(this, update)
    },

    // Each part module is an HMR boundary that reloads its own frame, so a save
    // reloads only the frames whose part imports the saved module.
    transform(code, id) {
      if (!(id.split("?")[0] ?? "").endsWith(PART_SUFFIX)) return null
      return `${code}\nif (import.meta.hot) import.meta.hot.accept(() => location.reload())\n`
    },

    load(id) {
      // Caliper's own folder is outside the project's fs.allow, so read it here.
      if (id.startsWith(CLIENT_DIR)) return readFileSync(id, "utf8")
      const taken = overlay.load.call(this, id)
      if (taken !== null) return taken
      if (id !== RESOLVED_REACT_MODULE) return null
      return [
        'export { createElement } from "react"',
        'export { createRoot } from "react-dom/client"',
      ].join("\n")
    },

    configureServer(server) {
      const session = createSession(server, root, options, env, overlay)
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? "/", "http://caliper.local")
        if (url.pathname !== CALIPER_PATH && !url.pathname.startsWith(`${CALIPER_PATH}/`)) return next()
        session.handle(url, request, response).catch(next)
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
 * @param {Record<string, string | undefined>} env the shell's environment and the project's .env files
 * @param {ReturnType<typeof takeOverlay>} overlay
 */
function createSession(server, root, options, env, overlay) {
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
  const takesDir = join(root, TAKES_DIR)
  /** @param {string} file */
  const isProjectFile = file => !file.includes("/node_modules/") && !file.startsWith(takesDir)
  server.watcher.on("change", file => { if (isProjectFile(file)) void affects(file).then(yes => yes && refresh()) })
  // A new or removed file can be a part, or can satisfy an import that did not resolve before.
  server.watcher.on("add", file => { if (isProjectFile(file)) refresh() })
  server.watcher.on("unlink", file => { if (isProjectFile(file)) refresh() })

  const base = server.config.base.replace(/\/$/, "")
  const store = createTakeStore(root)

  const agent = resolveAgent({ option: options.agent, env, home: homedir() })
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let takesTimer
  /** Tell every open chrome about the takes, at most once per TAKES_DELAY_MS while an agent streams. */
  const takesChanged = () => {
    takesTimer ??= setTimeout(() => {
      takesTimer = undefined
      const data = JSON.stringify(takes.snapshot())
      for (const stream of streams) stream.write(`event: takes\ndata: ${data}\n\n`)
    }, TAKES_DELAY_MS)
  }
  const takes = createTakesApi({
    store,
    status: agent.status,
    connection: agent.connection,
    project: async () => (await load()).project,
    serverUrl: () => listeningOrigin(server),
    chromium: env.CHROMIUM,
    onChange: takesChanged,
  })

  /** @param {string} file root-relative */
  const fileUrl = file => {
    const absolute = resolvePath(root, file)
    const inside = relative(root, absolute)
    return inside.startsWith("..") ? `${base}/@fs${absolute}` : `${base}/${inside.replaceAll("\\", "/")}`
  }

  /**
   * @param {URL} url
   * @param {import("node:http").IncomingMessage} request
   * @param {ServerResponse} response
   */
  const handle = async (url, request, response) => {
    const path = url.pathname.slice(CALIPER_PATH.length)
    if (await takes.handle(path, request, response)) return undefined
    if (path === "") return redirect(response, `${base}${CALIPER_PATH}/`)
    if (path === "/") return send(response, 200, "text/html", chromePage({ clientUrl: `${base}${CALIPER_PATH}/client` }))
    if (path === "/project.json") return send(response, 200, "application/json", (await load()).json)
    if (path === "/events") return openStream(response, (await load()).json)
    if (path === "/frame") {
      const params = url.searchParams
      return sendFrame(params.get("part") ?? "", params.get("state") ?? "default", params.get("take"), response)
    }
    if (path.startsWith("/client/")) return sendClientFile(path.slice("/client/".length), response)
    return send(response, 404, "text/plain", `Caliper has no page at ${url.pathname}.`)
  }

  /**
   * @param {string} partFile
   * @param {string} stateName the export to render
   * @param {string | null} take the take to overlay, or null for the real files
   * @param {ServerResponse} response
   */
  const sendFrame = async (partFile, stateName, take, response) => {
    const { project } = await load()
    const part = project.parts.find(candidate => candidate.file === partFile)
    const problem = part === undefined
      ? `"${partFile}" is not a part of ${project.name}. Pick a part from the list.`
      : !part.states.some(state => state.export === stateName)
        ? `${partFile} has no state "${stateName}". Its states are: ${part.states.map(state => state.export).join(", ")}.`
        : take !== null && (!isTakeId(take) || store.record(take) === null)
          ? `Take ${take} does not exist. It may have been accepted or discarded.`
          : null
    const wrapper = project.wrapper._tag === "Failed" ? [] : project.wrapper.value.elements
    const sheets = project.css._tag === "Failed" ? [] : project.css.value.stylesheets.map(sheet => resolvePath(root, sheet.file))
    const flat = take === null || problem !== null ? null : overlay.prepareStylesheets(take, sheets, file => {
      const graph = server.environments.client?.moduleGraph
      for (const mod of graph?.getModulesByFile(file) ?? []) {
        if (mod.id && takeOf(mod.id) === take) graph?.invalidateModule(mod)
      }
    })
    const css = flat === null
      ? sheets.map(file => fileUrl(relative(root, file)))
      : flat.order.map(file => withTake(fileUrl(relative(root, file)), /** @type {string} */ (take)))
    const tag = (/** @type {string} */ url) => (flat === null ? url : withTake(url, /** @type {string} */ (take)))
    /** @type {FrameConfig} */
    const config = {
      part: tag(fileUrl(partFile)),
      partFile,
      state: stateName,
      ...(flat === null ? {} : { take: /** @type {string} */ (take) }),
      css,
      warnings: [
        ...(project.css._tag === "Failed" ? [`${project.css.reason} ${project.css.hint}`] : []),
        ...(flat?.problems ?? []),
      ],
      wrapper,
      react: `${base}/@id/__x00__${RESOLVED_REACT_MODULE.slice(1)}`,
    }
    const takeQuery = flat === null ? "" : `&take=${take}`
    const frameUrl = `${CALIPER_PATH}/frame?part=${encodeURIComponent(partFile)}&state=${encodeURIComponent(stateName)}${takeQuery}`
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
    response.write(`event: takes\ndata: ${JSON.stringify(takes.snapshot())}\n\n`)
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
