// @ts-check
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { basename, isAbsolute, join, relative, resolve as resolvePath } from "node:path"
import { fileURLToPath } from "node:url"
import { loadEnv, mergeConfig } from "vite"
import { deriveProject } from "./derive/project.js"
import { discoverParts, PART_SUFFIX } from "./derive/parts.js"
import { codeChange, createCodeApi } from "./code/api.js"
import { createKnobsApi } from "./knobs/api.js"
import { createChecksApi } from "./checks/api.js"
import { createSourceRevision } from "./checks/source-revision.js"
import { checkSource } from "./authored/source.js"
import { authoredCheckDelivery } from "./authored/delivery.js"
import { listeningOrigin } from "./server-origin.js"
import { reportLateChanges } from "./late-changes.js"
import { framePage } from "./pages.js"
import { json } from "./http.js"
import { createHostApi } from "./host/api.js"
import { createMarkStore } from "./takes/marks.js"
import { createIntegrationReview } from "./takes/integration.js"
import { newToken, projectId, PROTOCOL, registryDir, tokenMatches, writeEntry } from "./central/registry.js"
import { takeOf, takeOverlay, withTake } from "./takes/overlay.js"
import { createTakeStore, isTakeId, TAKES_DIR } from "./takes/store.js"
import { takeParts } from "./takes/parts.js"

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
/** The Vite settings that would move the HMR socket off the path the central app routes. */
const HMR_SETTINGS = ["path", "port", "clientPort", "server", "host"]
// Only the product-frame bootstrap goes through the consumer's Vite.
const CLIENT_FILES = new Map([
  ["frame.js", "text/javascript"],
  ["frame.css", "text/css"],
])
const REACT_MODULE = "virtual:caliper/react"
const RESOLVED_REACT_MODULE = "\0caliper:react"
/** The project's React packages the frame loads, pre-bundled so the first load does not reload. */
const REACT_PACKAGES = ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"]
/** Registry files to remove when the process exits without closing Vite. */
const LEAVING = new Set()
process.once("exit", () => { for (const leave of LEAVING) leave() })
const REFRESH_DELAY_MS = 80
/** The longest a frame page waits for Vite's first dependency bundle. */
const OPTIMIZE_WAIT_MS = 60_000

/**
 * Caliper: see the project's own UI parts at true physical device size.
 *
 * Add it to the project's vite.config and open the Caliper app. The plugin
 * announces the dev server in the registry; the app finds it there. It runs
 * only under `vite dev`, never in a build.
 *
 * @param {CaliperOptions} [options] overrides, only for when a derivation fails
 * @returns {Plugin}
 */
export function caliper(options = {}) {
  if (options !== null && typeof options === "object" && "agent" in options) {
    throw new Error("caliper({ agent }) is gone: the Caliper app owns the agent now. Move the agent settings to ~/.config/caliper/config.json as { \"agent\": { \"model\": ... } } and remove agent from vite.config.")
  }
  /** @type {string} */
  let root = process.cwd()
  let cacheDir = join(root, "node_modules/.vite")
  let base = ""
  const overlay = takeOverlay(() => root, () => cacheDir)
  const checkDelivery = authoredCheckDelivery()
  /** @type {Record<string, string | undefined>} */
  let env = { ...process.env }
  let closeSession = async () => {}

  return {
    name: "caliper",
    apply: "serve",

    config(userConfig) {
      root = resolvePath(userConfig.root ?? process.cwd())
      const hmr = userConfig.server?.hmr
      const own = hmr !== null && typeof hmr === "object" ? HMR_SETTINGS.filter(key => /** @type {Record<string, unknown>} */ (hmr)[key] !== undefined) : []
      if (own.length > 0) {
        throw new Error(`Caliper routes Vite's HMR socket through the Caliper app, so it cannot use server.hmr.${own.join(", server.hmr.")} from vite.config. Remove ${own.length === 1 ? "that setting" : "those settings"} while Caliper is in the plugins.`)
      }
      const parts = discoverParts(root).map(part => part.file)
      const require = createRequire(join(root, "package.json"))
      const react = REACT_PACKAGES.filter(name => canResolve(require, name))
      return mergeConfig({
        optimizeDeps: {
          entries: parts,
          include: react,
        },
        // A knob maps a rule the browser holds to its source file through
        // the served CSS's sourcemap (decision 23). Served CSS gets larger.
        css: { devSourcemap: true },
        // The socket path names the project, so the Caliper app can route it (decision 37).
        ...(hmr === false ? {} : { server: { hmr: { path: `__caliper/hmr/${projectId(root)}` } } }),
      }, checkDelivery.config())
    },

    configResolved(config) {
      root = config.root
      cacheDir = config.cacheDir
      base = config.base.replace(/\/$/, "")
      // The shell's environment wins over .env files, as in Vite itself.
      env = { ...loadEnv(config.mode, typeof config.envDir === "string" ? config.envDir : root, ""), ...process.env }
    },

    resolveId: {
      // Before vite:resolve, which would drop a take's tag from the import.
      order: "pre",
      async handler(id, importer, resolveOptions) {
        if (id === REACT_MODULE) return RESOLVED_REACT_MODULE
        const checkRuntime = await checkDelivery.resolveId.call(this, id, importer)
        if (checkRuntime) return checkRuntime
        const tagged = await overlay.resolveId.call(this, id, importer, resolveOptions)
        if (tagged) return tagged
        // Vite pre-transforms the frame page's script. Point it at the real file,
        // although Caliper's middleware serves the request itself.
        const client = clientFile(base && id.startsWith(`${base}/`) ? id.slice(base.length) : id)
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
      const checkRuntime = checkDelivery.load(id)
      if (checkRuntime !== null) return checkRuntime
      // Caliper's own folder is outside the project's fs.allow, so read it here.
      if (id.startsWith(CLIENT_DIR)) return readFileSync(id, "utf8")
      const taken = overlay.load.call(this, id)
      if (taken !== null) return taken
      if (id !== RESOLVED_REACT_MODULE) return null
      return [
        'export { createElement, useLayoutEffect } from "react"',
        'export { createRoot } from "react-dom/client"',
      ].join("\n")
    },

    closeBundle() {
      return closeSession()
    },

    configureServer(server) {
      const session = createSession(server, root, options, env, overlay)
      closeSession = session.close
      const base = server.config.base.replace(/\/$/, "")
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? "/", "http://caliper.local")
        if (base && !url.pathname.startsWith(`${base}${CALIPER_PATH}`)) return next()
        if (base) url.pathname = url.pathname.slice(base.length)
        if (url.pathname !== CALIPER_PATH && !url.pathname.startsWith(`${CALIPER_PATH}/`)) return next()
        session.handle(url, request, response).catch(next)
      })

      /** @type {() => void} */
      let unregister = () => {}
      server.httpServer?.once("listening", () => {
        const url = listeningOrigin(server)
        if (url === null) return
        try {
          unregister = writeEntry(registryDir(), {
            protocol: PROTOCOL, id: session.id, pid: process.pid, root, name: projectName(root),
            url: `${url}/`, base: server.config.base, token: session.token, started: new Date().toISOString(),
          })
        } catch (error) {
          server.config.logger.error(`Caliper could not register this dev server: ${error instanceof Error ? error.message : String(error)}`)
        }
      })
      const leave = () => { unregister(); unregister = () => {}; LEAVING.delete(leave) }
      server.httpServer?.once("close", leave)
      LEAVING.add(leave)

      const printUrls = server.printUrls.bind(server)
      server.printUrls = () => {
        printUrls()
        server.config.logger.info(`  \u279c  Caliper: open the Caliper app; this server is project ${session.id}`)
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
  let closed = false

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
    if (closed) return
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(async () => {
      if (closed) return
      try {
        const before = current ? (await current).json : null
        if (closed) return
        current = null
        const after = (await load()).json
        if (closed || after === before) return
        for (const stream of streams) stream.write(`event: project\ndata: ${after}\n\n`)
      } catch (error) {
        if (!closed) server.config.logger.error(`Caliper could not refresh the project: ${error instanceof Error ? error.message : String(error)}`)
      }
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
  const sourceRevision = createSourceRevision({ root, store, cacheDir: server.config.cacheDir })
  for (const event of ["change", "add", "unlink", "addDir", "unlinkDir"]) server.watcher.on(event, sourceRevision.invalidate)

  // The code pane follows every file on disk: the real files and the takes' copies.
  /** @param {string} file */
  const codeChanged = file => {
    const change = codeChange(root, file)
    if (closed || change === null) return
    const data = JSON.stringify(change)
    for (const stream of streams) stream.write(`event: code\ndata: ${data}\n\n`)
  }
  server.watcher.on("change", codeChanged)
  server.watcher.on("add", codeChanged)
  server.watcher.on("unlink", codeChanged)

  const id = projectId(root)
  const token = newToken()
  server.httpServer?.once("close", () => { void close() })
  // Vite's watcher drops a second save within 50 ms. Every writer hits it: an
  // agent, the code pane, a knob and the user's own editor.
  const stopLateChanges = reportLateChanges(server.watcher)
  const code = createCodeApi({ store, project: async () => (await load()).project, resolve })
  const host = createHostApi({ store, marks: createMarkStore(root), integration: createIntegrationReview(store), root, home: homedir() })

  /**
   * A knob's write into a take is an edit by hand. The Caliper app's agent
   * hears of it on the event stream, so its next prompt names the file.
   *
   * @param {string} take @param {string} file @param {string} content
   */
  const writeTake = (take, file, content) => {
    if (store.record(take) === null) throw new Error(`Take ${take} does not exist.`)
    let inside = file
    if (content === store.original(file)) store.reset(take, file)
    else inside = store.write(take, file, content)
    const data = JSON.stringify({ take, file: inside })
    for (const stream of streams) stream.write(`event: edit\ndata: ${data}\n\n`)
  }
  const knobs = createKnobsApi({ store, writeTake, options: options.knobs })

  const checks = createChecksApi({
    store,
    project: async () => (await load()).project,
    serverUrl: () => listeningOrigin(server),
    chromium: env.CHROMIUM,
    cacheDir: server.config.cacheDir,
    onChange: () => {
      const data = JSON.stringify(checks.snapshot())
      for (const stream of streams) stream.write(`event: checks\ndata: ${data}\n\n`)
    },
  })
  for (const event of ["change", "add", "unlink", "addDir", "unlinkDir"]) server.watcher.on(event, checks.invalidate)

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
    // Reads stay open, as Vite's own modules are. Every write needs this
    // server's token, which only the registry file holds (decision 37).
    if (request.method !== "GET" && request.method !== "HEAD") {
      if (!tokenMatches(request.headers.authorization, token)) {
        return json(response, 401, { error: "Caliper's dev server takes writes only from the Caliper app. Open this project there." })
      }
      // The token proves the Caliper app, which checked the page's origin itself.
      delete request.headers.origin
    }
    if (path === "/hello") return json(response, 200, { protocol: PROTOCOL, id, pid: process.pid, name: projectName(root), root })
    if (path === "/host") return host.handle(request, response)
    if (await code.handle(path, url, request, response)) return undefined
    if (await knobs.handle(path, request, response)) return undefined
    if (await checks.handle(path, url, request, response)) return undefined
    if (path === "" || path === "/") {
      return send(response, 404, "text/plain", `Caliper's chrome is not on the dev server any more. Open the Caliper app (bin/caliper.mjs); it lists this server as project ${id}.`)
    }
    if (["/project.json", "/check-source", "/check-revision"].includes(path)) {
      const take = url.searchParams.get("take") ?? undefined
      if (take !== undefined && (!isTakeId(take) || store.record(take) === null)) return send(response, 404, "application/json", JSON.stringify({ error: "Take does not exist." }))
      if (path === "/check-source") return send(response, 200, "application/json", JSON.stringify(checkSource({ store, revision: sourceRevision, take })))
      if (path === "/check-revision") return send(response, 200, "application/json", JSON.stringify(sourceRevision.stamp({ take })))
      // Keep the session's project and the discovery response on the same revision.
      current = null
      const { project } = await load()
      return send(response, 200, "application/json", JSON.stringify({ ...project, parts: take === undefined ? project.parts : takeParts(store, take, project.parts) }))
    }
    if (path === "/events") return openStream(response, (await load()).json)
    if (path === "/frame") {
      const params = url.searchParams
      return sendFrame(params.get("part") ?? "", params.get("state") ?? "default", params.get("take"), response)
    }
    if (path.startsWith("/client/")) return sendClientFile(path.slice("/client/".length), response)
    return send(response, 404, "text/plain", `Caliper has no page at ${url.pathname}.`)
  }

  /**
   * Wait for Vite's first dependency bundle before serving a frame, at most
   * OPTIMIZE_WAIT_MS. On a cold cache that bundle (React, CodeMirror, the check
   * libraries) can take longer than the frame watchdog, which would then report
   * a slow part when only the one-time bundle is slow. After the cap the frame
   * is served anyway, so a stuck optimizer still ends in the watchdog's report.
   */
  const dependenciesReady = async () => {
    const optimizer = server.environments.client?.depsOptimizer
    if (!optimizer) return
    const bundled = (async () => {
      await optimizer.scanProcessing
      const metadata = optimizer.metadata
      await Promise.all(REACT_PACKAGES.map(name => (metadata.optimized[name] ?? metadata.discovered[name])?.processing))
    })()
    await capped(bundled)
  }

  /**
   * Transform a frame's part and every local module it imports before the page
   * is sent, at most OPTIMIZE_WAIT_MS. Vite transforms modules on request, so a
   * large part's first load (the chrome's own app is 37 modules) can take longer
   * than the watchdog while nothing is wrong with the part. Warm modules are
   * cached, so later loads skip this. Dependencies are already bundled.
   *
   * @param {string} url the part's module URL, as the frame imports it
   */
  const partReady = async url => {
    const environment = server.environments.client
    if (!environment) return
    /** @type {Set<string>} */
    const seen = new Set()
    /** @param {string} next */
    const visit = async next => {
      if (seen.has(next) || next.includes("/node_modules/")) return
      seen.add(next)
      try { await environment.transformRequest(next) } catch { return }
      const mod = await environment.moduleGraph.getModuleByUrl(next)
      await Promise.all([...(mod?.importedModules ?? [])].map(child => child.url ? visit(child.url) : undefined))
    }
    await capped(visit(url))
  }

  /** @param {Promise<unknown>} work */
  const capped = async work => {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer
    await Promise.race([work.catch(() => {}), new Promise(resolve => { timer = setTimeout(resolve, OPTIMIZE_WAIT_MS) })])
    clearTimeout(timer)
  }

  /**
   * @param {string} partFile
   * @param {string} stateName the export to render
   * @param {string | null} take the take to overlay, or null for the real files
   * @param {ServerResponse} response
   */
  const sendFrame = async (partFile, stateName, take, response) => {
    await dependenciesReady()
    const { project } = await load()
    const parts = take !== null && isTakeId(take) && store.record(take) !== null ? takeParts(store, take, project.parts) : project.parts
    const part = parts.find(candidate => candidate.file === partFile)
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
      ...(part?.expectations?.[stateName] ? { expectations: part.expectations[stateName] } : {}),
      ...(part?.expectationProblems?.length ? { expectationProblems: part.expectationProblems } : {}),
      ...(flat === null ? {} : { take: /** @type {string} */ (take) }),
      css,
      warnings: [
        ...(project.css._tag === "Failed" ? [`${project.css.reason} ${project.css.hint}`] : []),
        ...(flat?.problems ?? []),
        ...(part?.compositionProblems ?? []).map(problem => `Composition: ${problem}`),
      ],
      wrapper,
      react: `${base}/@id/__x00__${RESOLVED_REACT_MODULE.slice(1)}`,
    }
    const takeQuery = flat === null ? "" : `&take=${take}`
    const frameUrl = `${CALIPER_PATH}/frame?part=${encodeURIComponent(partFile)}&state=${encodeURIComponent(stateName)}${takeQuery}`
    // Vite prefixes HTML resource URLs with its base during transformation.
    // The JSON config already has final URLs and is not transformed by Vite.
    if (problem === null) await partReady(config.part.slice(base.length) || config.part)
    const html = framePage({ clientUrl: `${CALIPER_PATH}/client`, config, problem })
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
    response.write(`event: checks\ndata: ${JSON.stringify(checks.snapshot())}\n\n`)
    streams.add(response)
    response.on("close", () => streams.delete(response))
  }

  const close = async () => {
    closed = true
    clearTimeout(refreshTimer)
    for (const stream of streams) stream.end()
    streams.clear()
    for (const event of ["change", "add", "unlink", "addDir", "unlinkDir"]) {
      server.watcher.off(event, checks.invalidate)
      server.watcher.off(event, sourceRevision.invalidate)
    }
    sourceRevision.close()
    stopLateChanges()
    await checks.close()
    // Vite awaits closeBundle before a test or caller removes the project root.
    // Await a derivation already in flight as well as cancelling queued work.
    await current?.catch(() => {})
  }

  return { handle, close, id, token }
}

/**
 * The project's name: `name` in its package.json, else its folder's name.
 *
 * @param {string} root
 */
function projectName(root) {
  try {
    const name = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).name
    if (typeof name === "string" && name.trim() !== "") return name.trim()
  } catch { /* no readable package.json */ }
  return basename(root)
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
