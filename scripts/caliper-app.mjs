// @ts-check
// Start a project's dev server with the plugin and the Caliper app in front of
// it (decision 37), for verification scripts. The app gets its own registry,
// settings and state folders, so a script never reads this machine's own.
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startCentral } from "../src/central/server.js"
import { readSettings, settingsFile } from "../src/central/config.js"
import { projectId } from "../src/central/registry.js"

/** One registry for every server this process starts. The plugin reads it from the environment. */
export function useScriptRegistry() {
  process.env.CALIPER_REGISTRY ??= mkdtempSync(join(tmpdir(), "caliper-registry-"))
  return process.env.CALIPER_REGISTRY
}
// Set it on import, before any script starts a dev server: the plugin registers when Vite listens.
useScriptRegistry()

/**
 * Start the Caliper app on an OS-assigned port.
 *
 * @param {{ agent?: import("../src/types").AgentOptions, port?: number, host?: string }} [options]
 */
export async function startApp(options = {}) {
  const registry = useScriptRegistry()
  const state = mkdtempSync(join(tmpdir(), "caliper-app-state-"))
  return startCentral({ port: options.port ?? 0, ...(options.host ? { host: options.host } : {}), registry, stateDir: state, settings: join(state, "no-settings.json"), ...("agent" in options ? { agent: options.agent } : {}) })
}

/**
 * The agent settings of this machine's Caliper app, for a script that spends
 * real model tokens. The key still comes from the script's environment.
 *
 * @param {string | undefined} [model] A model id that replaces the settings' own.
 * @returns {import("../src/types").AgentOptions}
 */
export function liveAgent(model) {
  const file = settingsFile()
  const agent = readSettings(file).agent
  if (agent === undefined) throw new Error(`${file} has no "agent". A real-model script uses the Caliper app's agent settings.`)
  return model === undefined ? agent : { ...agent, model }
}

/** @type {WeakSet<object>} */
const routedContexts = new WeakSet()
/**
 * Install the app's routing service worker in a page's browser context, for a
 * page that is not the chrome, such as a test harness under a project's path.
 * The chrome installs it itself.
 *
 * @param {import("playwright-core").Page} page
 * @param {{ url: string }} app
 */
export async function installRouting(page, app) {
  if (routedContexts.has(page.context())) return
  // The page itself visits the app's list once; its next navigation is controlled.
  await page.goto(new URL("/__caliper/", app.url).href)
  await page.evaluate(async () => { await navigator.serviceWorker.register("/__caliper/sw.js", { scope: "/" }); await navigator.serviceWorker.ready })
  routedContexts.add(page.context())
}

/**
 * The chrome's base URL for the project at `root`, once its dev server is in
 * the registry. Relative paths such as `__caliper/project.json` work on it as
 * they did on the dev server.
 *
 * @param {Awaited<ReturnType<typeof startApp>>} app
 * @param {string} root
 * @param {number} [timeout]
 */
export async function projectBase(app, root, timeout = 30_000) {
  const id = projectId(root)
  const end = Date.now() + timeout
  for (;;) {
    const url = await app.projectUrl(id)
    if (url !== null) return url
    if (Date.now() > end) throw new Error(`The dev server for ${root} did not register within ${timeout} ms.`)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}
