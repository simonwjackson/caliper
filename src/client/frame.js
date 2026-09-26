// @ts-check

/**
 * Runs inside one device frame. Loads the project's global CSS, its React and
 * one part, and renders the part inside the app's outer shell.
 *
 * Every failure ends as a visible panel, and the parent chrome hears about it.
 * The frame is never left blank without a reason on screen.
 */

/**
 * @typedef {import("../types").FrameConfig & { problem: string | null }} Config
 * @typedef {"Loading" | "Rendered" | "Empty" | "Failed"} FrameState
 * @typedef {{ kind: "error" | "warning", title: string, detail: string }} Problem
 * @typedef {{ createElement: (type: unknown) => unknown, createRoot: (container: Element, options?: object) => { render: (element: unknown) => void } }} ReactModule
 */

const configElement = document.getElementById("caliper-frame-config")
/** @type {Config} */
const config = JSON.parse(configElement?.textContent ?? "{}")
const host = /** @type {HTMLElement} */ (document.getElementById("caliper-host"))

/** @type {FrameState} */
let state = "Loading"
/** @type {Problem[]} */
const problems = []

/**
 * Record the frame's state on the document, for tests, and tell the chrome.
 * The chrome shows the problems at a readable size, because text inside a
 * true-size frame can be too small to read.
 *
 * @param {FrameState} next
 */
function setState(next) {
  state = next
  document.documentElement.dataset.caliperState = next
  // For a frame opened on its own, for example by caliper-render.
  const report = { part: config.partFile, partState: config.state, take: config.take ?? null, state: next, problems }
  Object.assign(window, { caliperReport: report })
  if (window.parent !== window) {
    window.parent.postMessage({ source: "caliper-frame", ...report }, location.origin)
  }
}

/**
 * Show a failure over the frame. Later failures add to the same panel.
 *
 * @param {string} title
 * @param {unknown} [error]
 * @param {string} [extra]
 */
function fail(title, error, extra) {
  let panel = document.getElementById("caliper-problem")
  if (!panel) {
    panel = document.createElement("div")
    panel.id = "caliper-problem"
    panel.setAttribute("role", "alert")
    document.body.append(panel)
  }
  const heading = document.createElement("strong")
  heading.textContent = title
  panel.append(heading)
  const detail = [describe(error), extra].filter(Boolean).join("\n\n")
  if (detail) {
    const pre = document.createElement("pre")
    pre.textContent = detail
    panel.append(pre)
  }
  problems.push({ kind: "error", title, detail })
  setState("Failed")
}

/**
 * Show a problem that does not stop the part from rendering.
 *
 * @param {string} text
 */
function warn(text) {
  let banner = document.getElementById("caliper-warning")
  if (!banner) {
    banner = document.createElement("div")
    banner.id = "caliper-warning"
    banner.setAttribute("role", "status")
    document.body.append(banner)
  }
  const line = document.createElement("div")
  line.textContent = text
  banner.append(line)
  problems.push({ kind: "warning", title: text, detail: "" })
  if (state !== "Loading") setState(state)
}

/** @param {unknown} error */
function describe(error) {
  if (error === undefined || error === null) return ""
  if (error instanceof Error) return error.stack?.includes(error.message) ? error.stack : `${error.message}\n${error.stack ?? ""}`
  return String(error)
}

/**
 * Import a module. When the import fails, ask the server for the reason,
 * because the browser reports only "failed to fetch".
 *
 * @param {string} url
 */
async function load(url) {
  try {
    return await import(/* @vite-ignore */ url)
  } catch (error) {
    const response = await fetch(url).catch(() => null)
    if (response && !response.ok) {
      const text = await response.text().catch(() => "")
      throw new Error(`${response.status} ${response.statusText} for ${url}\n${text.slice(0, 4000)}`)
    }
    throw error
  }
}

/** Two animation frames: long enough for React to commit its first render. */
function afterPaint() {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
}

window.addEventListener("error", event => {
  fail("The part threw an error", event.error ?? event.message)
})
window.addEventListener("unhandledrejection", event => {
  fail("The part rejected a promise nobody handled", event.reason)
})

async function run() {
  if (config.problem) return fail(config.problem)
  for (const warning of config.warnings ?? []) warn(warning)

  for (const url of config.css) {
    try {
      await load(url)
    } catch (error) {
      warn(`Global stylesheet ${url} did not load: ${describe(error).split("\n")[0]}`)
    }
  }

  /** @type {ReactModule} */
  let react
  try {
    react = await load(config.react)
  } catch (error) {
    return fail("Caliper could not load the project's React (react and react-dom/client)", error)
  }

  /** @type {Record<string, unknown>} */
  let part
  try {
    part = await load(config.part)
  } catch (error) {
    return fail(`${config.partFile} did not load`, error)
  }
  const component = part[config.state]
  if (typeof component !== "function") {
    return config.state === "default"
      ? fail(`${config.partFile} has no default export function`, undefined, "A part file must `export default function` a component that renders with no props.")
      : fail(`${config.partFile} has no exported component ${config.state}`, undefined, "A named state must be an exported component that renders with no props.")
  }

  let container = host
  for (const element of config.wrapper) {
    const node = document.createElement(element.tag)
    if (element.className) node.className = element.className
    container.append(node)
    container = node
  }

  const root = react.createRoot(container, {
    /** @param {unknown} error @param {{ componentStack?: string }} info */
    onUncaughtError(error, info) {
      fail(`${config.partFile} threw while rendering`, error, info?.componentStack?.trim())
    },
  })
  root.render(react.createElement(component))

  await afterPaint()
  if (state !== "Loading") return
  if (container.childNodes.length === 0) {
    warn(`${config.partFile} rendered nothing: its component returned null or an empty tree.`)
    return setState("Empty")
  }
  setState("Rendered")
}

run().catch(error => fail("Caliper's frame failed", error))
