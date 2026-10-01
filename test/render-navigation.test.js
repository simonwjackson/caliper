// @ts-check
import { expect, test } from "bun:test"
import { createServer } from "node:http"
import { getEventListeners } from "node:events"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { renderJobs } from "../src/render/render.js"
import { bounded, openBrowserSession } from "../src/render/browser-session.js"
import { observeFrame } from "../src/render/frame-observation.js"
import { checkJobs } from "../src/render/checks.js"
import { createSourceRevision } from "../src/checks/source-revision.js"
import { checkSource } from "../src/authored/source.js"
import { createTakeStore } from "../src/takes/store.js"

const browserTest = test.skipIf(!process.env.CHROMIUM)
const job = { part: "Reload.part.tsx", state: "default", device: "iphone-16", viewport: { width: 393, height: 852 } }

/** Real delayed font loading keeps the renderer inside page.evaluate while a document reloads.
 * @param {'once'|'always'|'away'|'away-back'|'failed'|'cancel'|'source-change'|'late'|'request-error'|'current-abort'|'prior-abort'|'hash-abort'} behavior
 * @param {(input:{url:string,out:string,frames:()=>number,signal:AbortSignal})=>Promise<void>} run
 */
async function fixture(behavior, run) {
  const root = mkdtempSync("/tmp/caliper-render-navigation-")
  const out = join(root, ".caliper/checks")
  writeFileSync(join(root, job.part), "export default () => null")
  const store = createTakeStore(root)
  const revision = createSourceRevision({ root, store })
  const controller = new AbortController()
  let frames = 0
  let framePath = ""
  /** @type {Set<ReturnType<typeof setTimeout>>} */
  const timers = new Set()
  const server = createServer((request, response) => {
    if (request.url === "/__caliper/check-source" || request.url === "/__caliper/check-revision") {
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify(request.url.endsWith("check-source") ? checkSource({ store, revision }) : revision.stamp({})))
      return
    }
    if (request.url?.startsWith("/pending.woff2")) {
      if (behavior === "source-change") {
        writeFileSync(join(root, job.part), `export default () => ${frames}`)
        revision.invalidate(join(root, job.part))
      }
      if (behavior === "cancel") {
        const error = new Error("Product sources changed during rendering.")
        error.name = "SourceChanged"
        controller.abort(error)
      }
      const timer = setTimeout(() => { timers.delete(timer); response.writeHead(404); response.end() }, 3000)
      timers.add(timer)
      return
    }
    if (request.url === "/missing.js") { response.writeHead(404); response.end(); return }
    if (request.url === "/cancelled-request") return
    if (request.url === "/favicon.ico") { response.writeHead(204); response.end(); return }
    frames++
    if (!framePath) framePath = request.url ?? ""
    if (request.url === "/away" && behavior === "away-back") {
      response.writeHead(200, { "content-type": "text/html" })
      response.end(`<script>location.replace(${JSON.stringify(framePath)})</script>`)
      return
    }
    const reload = behavior === "always" || behavior === "source-change" || (frames === 1 && !["failed", "current-abort", "hash-abort"].includes(behavior))
    const failed = behavior === "failed" || (behavior === "late" && frames > 1)
    response.writeHead(200, { "content-type": "text/html" })
    response.end(`<!doctype html><html><body><div id="caliper-host">Ready</div><script>
      window.addEventListener('load', () => {
        ${["current-abort", "prior-abort", "hash-abort"].includes(behavior) ? `const controller = new AbortController(); fetch('/cancelled-request', { signal: controller.signal }).catch(() => {}); setTimeout(() => controller.abort(), 20);` : ""}
        ${behavior === "hash-abort" ? "location.hash = 'same-document';" : ""}
        ${behavior === "request-error" && frames === 1 ? `const script = document.createElement('script'); script.src = '/missing.js'; document.head.appendChild(script);` : ""}
        ${reload ? `const reload = () => { const face = new FontFace('Pending', 'url(/pending.woff2)'); document.fonts.add(face); face.load().catch(() => {}); document.getElementById('caliper-host').style.fontFamily = 'Pending'; setTimeout(() => ${["away", "away-back"].includes(behavior) ? "location.href = '/away'" : "location.reload()"}, 100); }; ${behavior === "late" ? `Object.defineProperty(window, 'caliperReport', { get() { reload(); return { problems: [] }; } });` : "reload();"}` : ""}
        document.documentElement.dataset.caliperState = '${failed ? "Failed" : "Rendered"}';
        ${failed ? `window.caliperReport = { problems: [{ kind: 'error', title: 'Deliberate broken render', detail: '' }] };` : ""}
      });
    </script></body></html>`)
  })
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(undefined)))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Fixture server did not listen.")
    await run({ url: `http://127.0.0.1:${address.port}`, out, frames: () => frames, signal: controller.signal })
  } finally {
    for (const timer of timers) clearTimeout(timer)
    server.closeAllConnections()
    await new Promise(resolve => server.close(() => resolve(undefined)))
    rmSync(root, { recursive: true, force: true })
  }
}

/** @param {(page:import('playwright-core').Page,url:string,out:string)=>Promise<void>} run */
async function inFrame(run) {
  await fixture("failed", async ({ url, out }) => {
    const session = await openBrowserSession(/** @type {string} */ (process.env.CHROMIUM))
    try {
      const context = await session.browser.newContext()
      const page = await context.newPage()
      const target = `${url}/__caliper/frame`
      await page.goto(target)
      await run(page, target, out)
    } finally { await session.close() }
  })
}

browserTest("a coincident reload does not suppress a real filesystem failure", async () => {
  await inFrame(async (page, url, out) => {
    let attempts = 0
    await expect(bounded(signal => observeFrame({ page, url, signal, observe: async () => {
      attempts++
      if (attempts === 1) {
        await page.reload()
        writeFileSync(join(out, "missing/output.png"), "image")
      }
      return "Ready"
    } }))).rejects.toThrow("ENOENT")
    expect(attempts).toBe(1)
  })
}, 20000)

browserTest("a screenshot navigation failure retries only after a matching frame commit", async () => {
  await inFrame(async (page, url) => {
    let attempts = 0
    const result = await bounded(signal => observeFrame({ page, url, signal, observe: async () => {
      if (++attempts === 1) {
        await page.reload()
        throw new Error("Protocol error (Page.captureScreenshot): Unable to capture screenshot")
      }
      return "Ready"
    } }))
    expect(result).toBe("Ready")
    expect(attempts).toBe(2)
  })
}, 20000)

browserTest("a compositor capture race can retry after a paint without inventing a navigation", async () => {
  await inFrame(async (page, url) => {
    let attempts = 0
    const result = await bounded(signal => observeFrame({ page, url, signal, observe: async () => {
      if (++attempts === 1) throw new Error("Protocol error (Page.captureScreenshot): Unable to capture screenshot")
      return "Ready"
    } }))
    expect(result).toBe("Ready")
    expect(attempts).toBe(2)
    expect(page.url()).toBe(url)
  })
}, 20000)

browserTest("cancellation cleans up an observation waiting for a commit that never arrives", async () => {
  await inFrame(async (page, url) => {
    const controller = new AbortController()
    const pending = observeFrame({ page, url, signal: controller.signal, observe: async () => {
      throw new Error("page.evaluate: Execution context was destroyed")
    } })
    const timer = setTimeout(() => controller.abort(new Error("Source monitor stopped the observation")), 20)
    try { await expect(pending).rejects.toThrow("Source monitor stopped the observation") }
    finally { clearTimeout(timer) }
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0)
  })
}, 20000)

browserTest("deadline expiry ends the helper as well as its bounded caller while awaiting a commit", async () => {
  await inFrame(async (page, url) => {
    /** @type {Promise<string>|undefined} */
    let pending
    /** @type {AbortSignal|undefined} */
    let operationSignal
    await expect(bounded(signal => {
      operationSignal = signal
      pending = observeFrame({ page, url, signal, observe: async () => {
        throw new Error("page.evaluate: Execution context was destroyed")
      } })
      return pending
    }, { timeout: 30 })).rejects.toThrow("deadline")
    await expect(pending).rejects.toThrow("deadline")
    if (!operationSignal) throw new Error("The observation did not start.")
    expect(getEventListeners(operationSignal, "abort")).toHaveLength(0)
  })
}, 20000)

browserTest("a same-frame reload during font loading restarts the complete visual observation", async () => {
  await fixture("once", async ({ url, out, frames }) => {
    const results = await renderJobs({ url, jobs: [job], out, executablePath: /** @type {string} */ (process.env.CHROMIUM), audit: true })
    expect(frames()).toBe(2)
    expect(results[0]?.frame).toBe("Rendered")
    expect(results[0]?.accessibility?._tag).toBe("Complete")
    expect(results[0]?.console).toEqual([])
    expect(results[0]?.png).toStartWith(join(out, "Reload"))
  })
}, 20000)

browserTest("checks retain a complete repeat-render report after a same-frame reload", async () => {
  await fixture("once", async ({ url, out, frames }) => {
    const result = await checkJobs({ url, project: "navigation-consumer", jobs: [job], out, executablePath: /** @type {string} */ (process.env.CHROMIUM) })
    expect(frames()).toBe(3)
    expect(result.report.version).toBe(2)
    if (result.report.version !== 2) throw new Error("Checks did not retain source identity.")
    expect(result.report.run.termination).toBe("Completed")
    expect(result.report.run.stale).toBe(false)
    expect(result.report.results[0]?.frame).toBe("Rendered")
    expect(result.report.results[0]?.authored?.status).toBe("NotRun")
    expect(result.report.results[0]?.checks.find(check => check.name === "browser")?.status).toBe("Passed")
    expect(result.report.results[0]?.checks.find(check => check.name === "determinism")?.status).toBe("Passed")
  })
}, 20000)

browserTest("a reload after measurement does not mix an old verdict with a new screenshot", async () => {
  await fixture("late", async ({ url, out, frames }) => {
    const results = await renderJobs({ url, jobs: [job], out, executablePath: /** @type {string} */ (process.env.CHROMIUM), audit: true })
    expect(frames()).toBe(2)
    expect(results[0]?.frame).toBe("Failed")
    expect(results[0]?.problems[0]?.title).toBe("Deliberate broken render")
  })
}, 20000)

browserTest("the real source monitor still interrupts a reloading check run after a product edit", async () => {
  await fixture("source-change", async ({ url, out }) => {
    await expect(checkJobs({ url, project: "navigation-consumer", jobs: [job], out, executablePath: /** @type {string} */ (process.env.CHROMIUM) }))
      .rejects.toThrow("Product or take sources changed during the check run")
  })
}, 20000)

browserTest("a continuously reloading frame stops after three observation attempts", async () => {
  await fixture("always", async ({ url, out, frames }) => {
    await expect(renderJobs({ url, jobs: [job], out, executablePath: /** @type {string} */ (process.env.CHROMIUM) }))
      .rejects.toThrow("did not settle after 3 rendering attempts")
    expect(frames()).toBeLessThanOrEqual(4)
  })
}, 20000)

browserTest("navigation away from the requested frame is not retried or reported as a render", async () => {
  await fixture("away", async ({ url, out }) => {
    await expect(renderJobs({ url, jobs: [job], out, executablePath: /** @type {string} */ (process.env.CHROMIUM) }))
      .rejects.toThrow("navigated away from the requested frame")
  })
}, 20000)

browserTest("navigation away and back still rejects the observation", async () => {
  await fixture("away-back", async ({ url, out }) => {
    await expect(renderJobs({ url, jobs: [job], out, executablePath: /** @type {string} */ (process.env.CHROMIUM) }))
      .rejects.toThrow("navigated away from the requested frame")
  })
}, 20000)

browserTest("genuine request errors from the abandoned document remain browser findings", async () => {
  await fixture("request-error", async ({ url, out, frames }) => {
    const results = await renderJobs({ url, jobs: [job], out, executablePath: /** @type {string} */ (process.env.CHROMIUM) })
    expect(frames()).toBe(2)
    expect(results[0]?.console.some(error => error.includes("HTTP 404") && error.includes("missing.js"))).toBe(true)
  })
}, 20000)

browserTest("a request cancelled by the sampled document remains a browser finding", async () => {
  await fixture("current-abort", async ({ url, out, frames }) => {
    const results = await renderJobs({ url, jobs: [job], out, executablePath: /** @type {string} */ (process.env.CHROMIUM), audit: true })
    expect(frames()).toBe(1)
    expect(results[0]?.console.some(error => error.includes("net::ERR_ABORTED") && error.includes("cancelled-request"))).toBe(true)
  })
}, 20000)

browserTest("a product-cancelled request before replacement stays a finding after a later reload", async () => {
  await fixture("prior-abort", async ({ url, out, frames }) => {
    const results = await renderJobs({ url, jobs: [job], out, executablePath: /** @type {string} */ (process.env.CHROMIUM), audit: true })
    expect(frames()).toBe(2)
    expect(results[0]?.console.some(error => error.includes("net::ERR_ABORTED") && error.includes("cancelled-request"))).toBe(true)
  })
}, 20000)

browserTest("fragment navigation does not turn a product-cancelled request into a replaced-document abort", async () => {
  await fixture("hash-abort", async ({ url, out, frames }) => {
    const results = await renderJobs({ url, jobs: [job], out, executablePath: /** @type {string} */ (process.env.CHROMIUM), audit: true })
    expect(frames()).toBe(1)
    expect(results[0]?.console.some(error => error.includes("net::ERR_ABORTED") && error.includes("cancelled-request"))).toBe(true)
  })
}, 20000)

browserTest("source cancellation wins over reload recovery", async () => {
  await fixture("cancel", async ({ url, out, signal, frames }) => {
    await expect(renderJobs({ url, jobs: [job], out, signal, executablePath: /** @type {string} */ (process.env.CHROMIUM) }))
      .rejects.toThrow("cancelled")
    expect(signal.reason.name).toBe("SourceChanged")
    expect(frames()).toBe(1)
  })
}, 20000)

browserTest("a broken frame stays failed and does not trigger reload recovery", async () => {
  await fixture("failed", async ({ url, out, frames }) => {
    const results = await renderJobs({ url, jobs: [job], out, executablePath: /** @type {string} */ (process.env.CHROMIUM) })
    expect(frames()).toBe(1)
    expect(results[0]?.frame).toBe("Failed")
    expect(results[0]?.problems[0]?.title).toBe("Deliberate broken render")
  })
}, 20000)
