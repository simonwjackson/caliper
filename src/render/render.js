// @ts-check
import { mkdirSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"
import { aborted, bounded, openBrowserSession } from "./browser-session.js"
import { runNodeWorker } from "./node-worker.js"
import { DEVICES } from "../client/device-frame.js"
import { FRAME_WATCHDOG_MS } from "../pages.js"
import { auditAccessibility, axeVersion } from "./accessibility.js"

/**
 * @typedef {import("./plan.js").RenderJob} RenderJob
 * @typedef {{ kind: "error" | "warning", title: string, detail: string }} Problem
 * @typedef {{
 *   part: string,
 *   state: string,
 *   device: string,
 *   take?: string,
 *   viewport: { width: number, height: number },
 *   frame: "Rendered" | "Empty" | "Failed",
 *   png: string,
 *   problems: Problem[],
 *   console: string[],
 *   spill: Spill | null,
 *   accessibility?: import("./check-contract.js").Accessibility,
 *   environment?: string,
 *   checks?: import("./check-contract.js").CheckResult[],
 *   authored?: import('../authored/contract.js').AuthoredResult,
 *   checkReport?: string,
 *   checkRun?: import('../authored/contract.js').CheckRun,
 *   expectations?: import('../expectation-contract.js').StateExpectations,
 *   expectationProblems?: readonly string[],
 * }} RenderResult
 *   `frame` is the frame's own verdict. `problems` are what the frame shows.
 *   `console` holds browser errors the frame did not catch, for example a
 *   failed request. `spill` is null when every element of the part lies
 *   inside the device's viewport.
 *
 * @typedef {{
 *   left: number, top: number, right: number, bottom: number,
 *   elements: Array<{ element: string, target?: string, left: number, top: number, right: number, bottom: number }>,
 *   complete?: boolean,
 * }} Spill
 *   The box, in CSS px, that holds every element of the part, when it reaches
 *   past the viewport. The content past the edge is clipped or scrolls: the
 *   device does not show it at first. Normal renders list up to 5 outermost
 *   elements; check renders measure every spilling element for scoped exceptions.
 */

/** Layout rounding that does not count as spill, in CSS px. */
const SPILL_TOLERANCE = 0.5
/** How many spilling elements a result names. */
const SPILL_ELEMENTS = 5

/** Frames rendered at the same time. Each one loads the project's CSS and React. */
const CONCURRENCY = 4

/** Completed samples survive cancellation without inventing results for other jobs. */
export class RenderInterrupted extends Error {
  /** @param {unknown} cause @param {RenderResult[]} completedRenders */
  constructor(cause, completedRenders) {
    super(cause instanceof Error ? cause.message : String(cause), { cause })
    this.name = cause instanceof Error ? cause.name : "Error"
    this.completedRenders = completedRenders
  }
}

/**
 * Render each job in a headless Chromium, one page per job, at the device's
 * CSS viewport and a device pixel ratio of 1. Loads the same frame page that
 * the chrome shows, from the project's running Vite server.
 *
 * @param {{ url: string, jobs: readonly RenderJob[], out: string, executablePath: string, audit?: boolean, signal?: AbortSignal }} input
 *   `url` is the dev server's origin. `out` is the folder for the PNG files.
 * @returns {Promise<RenderResult[]>} in job order
 */
export async function renderJobs({ url, jobs, out, executablePath, audit = false, signal }) {
  if (process.versions.bun) {
    const result = await runNodeWorker({ type: "render", input: { url, jobs: [...jobs], out, executablePath, audit } }, { signal })
    if (result.type !== "render") throw new Error("Browser worker returned the wrong operation.")
    return result.results
  }
  mkdirSync(out, { recursive: true })
  const session = await openBrowserSession(executablePath, signal)
  const group = new AbortController()
  const combined = AbortSignal.any([group.signal, ...(signal ? [signal] : [])])
  /** @type {RenderResult[]} */
  const results = new Array(jobs.length)
  try {
    let next = 0
    const worker = async () => {
      while (next < jobs.length) {
        const index = next++
        if (combined.aborted) throw aborted(combined.reason)
        try { results[index] = await renderOne(session, url, /** @type {RenderJob} */ (jobs[index]), out, audit, combined) }
        catch (error) { group.abort(error); throw error }
      }
    }
    const outcomes = await Promise.allSettled(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker))
    const failed = outcomes.find(outcome => outcome.status === "rejected")
    if (failed?.status === "rejected") throw failed.reason
    return results
  } catch (error) { throw new RenderInterrupted(error, results.filter(Boolean)) }
  finally {
    try { await session.close() }
    catch (error) { throw new RenderInterrupted(error, results.filter(Boolean)) }
  }
}

/**
 * @param {Awaited<ReturnType<typeof openBrowserSession>>} session
 * @param {string} url
 * @param {RenderJob} job
 * @param {string} out
 * @param {boolean} audit
 * @param {AbortSignal} [signal]
 * @returns {Promise<RenderResult>}
 */
async function renderOne(session, url, job, out, audit, signal) {
  const { browser } = session
  const device = DEVICES.find(candidate => candidate.id === job.device)
  if (device === undefined) throw new Error(`Unknown device ${job.device}`)
  const viewport = { width: device.cssWidth, height: device.cssHeight }
  const context = await bounded(() => browser.newContext({ viewport, deviceScaleFactor: 1 }), { signal })
  try {
    return await bounded(async () => {
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

    const takeQuery = job.take === undefined ? "" : `&take=${encodeURIComponent(job.take)}`
    const frameUrl = new URL(`/__caliper/frame?part=${encodeURIComponent(job.part)}&state=${encodeURIComponent(job.state)}${takeQuery}`, url)
    await page.goto(frameUrl.href)
    // The frame's watchdog fails the frame after FRAME_WATCHDOG_MS, so this always ends.
    await page.waitForFunction(() => {
      const state = document.documentElement.dataset.caliperState
      return state !== undefined && state !== "Loading"
    }, undefined, { timeout: FRAME_WATCHDOG_MS + 5_000 })
    // Web fonts change layout; wait for them before measuring and capturing.
    await page.evaluate(() => document.fonts.ready.then(() => undefined))
    // An entry animation, such as a card that drops into place, starts away from
    // where the part rests. Jump each animation that ends to its end, so the
    // spill and the PNG show the resting layout. A looping animation keeps running.
    await page.evaluate(() => {
      for (const animation of document.getAnimations()) {
        if (animation.effect?.getComputedTiming().endTime !== Infinity) animation.finish()
      }
    })

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
      /** @type {Array<{ element: string, target: string, left: number, top: number, right: number, bottom: number }>} */
      const elements = []
      /** @param {DOMRect} rect */
      const outside = rect => rect.left < -tolerance || rect.top < -tolerance || rect.right > width + tolerance || rect.bottom > height + tolerance
      /** @param {Element} element */
      const describe = element => {
        const classes = [...element.classList].slice(0, 3).map(name => `.${name}`).join("")
        return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${classes}`
      }
      // Copy this exact target from a finding into a product declaration. Full
      // ancestry avoids accepting an unrelated element with the same classes.
      /** @param {Element} element */
      const target = element => {
        const path = []
        let node = /** @type {Element | null} */ (element)
        while (node && node.id !== "caliper-host") {
          const parent = node.parentElement
          const siblings = parent ? [...parent.children].filter(child => child.tagName === node?.tagName) : []
          path.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`)
          node = parent
        }
        return `#caliper-host > ${path.join(" > ")}`
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
        if (outside(rect) && (limit === 0 || (!parentOutside && elements.length < limit))) {
          elements.push({ element: describe(element), target: target(element), left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom })
        }
      }
      const spill = elements.length === 0 ? null : {
        left: Math.round(box.left), top: Math.round(box.top), right: Math.round(box.right), bottom: Math.round(box.bottom), elements, complete: limit === 0,
      }
      /** @type {import('../types').FrameConfig} */
      const config = JSON.parse(document.getElementById("caliper-frame-config")?.textContent ?? "{}")
      return {
        ...(config.expectations ? { expectations: config.expectations } : {}),
        ...(config.expectationProblems ? { expectationProblems: config.expectationProblems } : {}),
        frame: root.dataset.caliperState ?? "Failed",
        problems: own?.problems ?? (watchdog ? [{ kind: "error", title: watchdog, detail: "" }] : []),
        spill,
      }
    }, { tolerance: SPILL_TOLERANCE, limit: audit ? 0 : SPILL_ELEMENTS })
    const png = join(out, `${slug(job.part)}${job.take === undefined ? "" : `.take-${job.take}`}.${job.state}.${job.device}.png`)
    await page.screenshot({ path: png })
    const accessibility = audit ? await auditAccessibility(page) : undefined

    return {
      ...job,
      viewport,
      frame: /** @type {RenderResult["frame"]} */ (report.frame),
      png,
      problems: report.problems,
      console: consoleErrors,
      spill: report.spill,
      ...(report.expectations ? { expectations: report.expectations } : {}),
      ...(report.expectationProblems ? { expectationProblems: report.expectationProblems } : {}),
      ...(accessibility === undefined ? {} : {
        accessibility,
        environment: `chromium:${browser.version()};${process.platform}:${process.arch};dpr:1;axe:${axeVersion};checks:2`,
      }),
    }
    }, { signal })
  } finally {
    await session.closeContext(context)
  }
}

/**
 * Keep names readable; the hash distinguishes paths such as a/b and a-b.
 *
 * @param {string} file
 */
function slug(file) {
  return `${file.replace(/\.part\.tsx$/, "").replaceAll("/", "-")}.${createHash("sha256").update(file).digest("hex").slice(0, 12)}`
}
