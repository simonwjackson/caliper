// @ts-check
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright-core"
import { DEVICES } from "../client/device-frame.js"
import { FRAME_WATCHDOG_MS } from "../pages.js"

/**
 * @typedef {import("./plan.js").RenderJob} RenderJob
 * @typedef {{ kind: "error" | "warning", title: string, detail: string }} Problem
 * @typedef {{
 *   part: string,
 *   state: string,
 *   device: string,
 *   viewport: { width: number, height: number },
 *   frame: "Rendered" | "Empty" | "Failed",
 *   png: string,
 *   problems: Problem[],
 *   console: string[],
 *   spill: Spill | null,
 * }} RenderResult
 *   `frame` is the frame's own verdict. `problems` are what the frame shows.
 *   `console` holds browser errors the frame did not catch, for example a
 *   failed request. `spill` is null when every element of the part lies
 *   inside the device's viewport.
 *
 * @typedef {{
 *   left: number, top: number, right: number, bottom: number,
 *   elements: Array<{ element: string, left: number, top: number, right: number, bottom: number }>,
 * }} Spill
 *   The box, in CSS px, that holds every element of the part, when it reaches
 *   past the viewport. The content past the edge is clipped or scrolls: the
 *   device does not show it at first. `elements` lists up to 5 of the
 *   outermost elements that reach past the edge.
 */

/** Layout rounding that does not count as spill, in CSS px. */
const SPILL_TOLERANCE = 0.5
/** How many spilling elements a result names. */
const SPILL_ELEMENTS = 5

/** Frames rendered at the same time. Each one loads the project's CSS and React. */
const CONCURRENCY = 4

/**
 * Render each job in a headless Chromium, one page per job, at the device's
 * CSS viewport and a device pixel ratio of 1. Loads the same frame page that
 * the chrome shows, from the project's running Vite server.
 *
 * @param {{ url: string, jobs: readonly RenderJob[], out: string, executablePath: string }} input
 *   `url` is the dev server's origin. `out` is the folder for the PNG files.
 * @returns {Promise<RenderResult[]>} in job order
 */
export async function renderJobs({ url, jobs, out, executablePath }) {
  mkdirSync(out, { recursive: true })
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
  try {
    /** @type {RenderResult[]} */
    const results = new Array(jobs.length)
    let next = 0
    const worker = async () => {
      while (next < jobs.length) {
        const index = next++
        results[index] = await renderOne(browser, url, /** @type {RenderJob} */ (jobs[index]), out)
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker))
    return results
  } finally {
    await browser.close()
  }
}

/**
 * @param {import("playwright-core").Browser} browser
 * @param {string} url
 * @param {RenderJob} job
 * @param {string} out
 * @returns {Promise<RenderResult>}
 */
async function renderOne(browser, url, job, out) {
  const device = DEVICES.find(candidate => candidate.id === job.device)
  if (device === undefined) throw new Error(`Unknown device ${job.device}`)
  const viewport = { width: device.cssWidth, height: device.cssHeight }
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 })
  try {
    const page = await context.newPage()
    /** @type {string[]} */
    const consoleErrors = []
    // Chromium's "Failed to load resource" message has no URL, so report the response instead.
    page.on("console", message => {
      if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) consoleErrors.push(message.text())
    })
    page.on("pageerror", error => consoleErrors.push(error.message))
    page.on("response", response => {
      if (response.status() >= 400) consoleErrors.push(`HTTP ${response.status()} for ${response.url()}`)
    })
    page.on("requestfailed", request => consoleErrors.push(`Request failed (${request.failure()?.errorText ?? "unknown"}) for ${request.url()}`))

    const frameUrl = new URL(`/__caliper/frame?part=${encodeURIComponent(job.part)}&state=${encodeURIComponent(job.state)}`, url)
    await page.goto(frameUrl.href)
    // The frame's watchdog fails the frame after FRAME_WATCHDOG_MS, so this always ends.
    await page.waitForFunction(() => {
      const state = document.documentElement.dataset.caliperState
      return state !== undefined && state !== "Loading"
    }, undefined, { timeout: FRAME_WATCHDOG_MS + 5_000 })
    // Web fonts change layout; wait for them before measuring and capturing.
    await page.evaluate(() => document.fonts.ready.then(() => undefined))

    const report = await page.evaluate(({ tolerance, limit }) => {
      const root = document.documentElement
      /** @type {{ state: string, problems: Problem[] } | undefined} */
      const own = /** @type {any} */ (window).caliperReport
      const watchdog = document.getElementById("caliper-problem")?.textContent ?? ""

      // Measure the part's elements, not the page's scroll size: an app shell
      // with overflow hidden clips content without making the page scroll.
      const width = window.innerWidth
      const height = window.innerHeight
      const box = { left: 0, top: 0, right: 0, bottom: 0 }
      /** @type {Array<{ element: string, left: number, top: number, right: number, bottom: number }>} */
      const elements = []
      /** @param {DOMRect} rect */
      const outside = rect => rect.left < -tolerance || rect.top < -tolerance || rect.right > width + tolerance || rect.bottom > height + tolerance
      /** @param {Element} element */
      const describe = element => {
        const classes = [...element.classList].slice(0, 3).map(name => `.${name}`).join("")
        return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${classes}`
      }
      for (const element of document.querySelectorAll("#caliper-host *")) {
        const rect = element.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) continue
        box.left = Math.min(box.left, rect.left)
        box.top = Math.min(box.top, rect.top)
        box.right = Math.max(box.right, rect.right)
        box.bottom = Math.max(box.bottom, rect.bottom)
        const parent = element.parentElement
        const parentOutside = parent !== null && parent.id !== "caliper-host" && outside(parent.getBoundingClientRect())
        if (outside(rect) && !parentOutside && elements.length < limit) {
          elements.push({ element: describe(element), left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom) })
        }
      }
      const spill = elements.length === 0 ? null : {
        left: Math.round(box.left), top: Math.round(box.top), right: Math.round(box.right), bottom: Math.round(box.bottom), elements,
      }
      return {
        frame: root.dataset.caliperState ?? "Failed",
        problems: own?.problems ?? (watchdog ? [{ kind: "error", title: watchdog, detail: "" }] : []),
        spill,
      }
    }, { tolerance: SPILL_TOLERANCE, limit: SPILL_ELEMENTS })
    const png = join(out, `${slug(job.part)}.${job.state}.${job.device}.png`)
    await page.screenshot({ path: png })

    return {
      ...job,
      viewport,
      frame: /** @type {RenderResult["frame"]} */ (report.frame),
      png,
      problems: report.problems,
      console: consoleErrors,
      spill: report.spill,
    }
  } finally {
    await context.close()
  }
}

/**
 * "src/ui/atoms/PicoButton.atom.part.tsx" becomes "src-ui-atoms-PicoButton.atom".
 *
 * @param {string} file
 */
function slug(file) {
  return file.replace(/\.part\.tsx$/, "").replaceAll("/", "-")
}
