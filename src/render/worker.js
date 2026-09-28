// @ts-check
// Fixed trusted process entry. Product paths are sent to Vite/Chromium, never imported here.
import { Check } from "typebox/value"
import { WorkerRequestSchema, WorkerReplySchema } from "./worker-contract.js"
import { renderJobs } from "./render.js"
import { checkJobs } from "./checks.js"

// The worker exists to run Playwright in real Node. If "node" on PATH is
// Bun (for example under `bunx --bun`), renderJobs would fork this worker
// again, and again. Stop here, so the chain is one level deep at most.
if (process.versions.bun) {
  process.stderr.write(
    "The browser worker started under Bun, not Node. Something put Bun on PATH as `node` " +
    "(bunx --bun or bun --bun does this). Start the dev server without --bun.\n",
  )
  process.exit(1)
}

const controller = new AbortController()
let started = false
const cancel = () => controller.abort(new DOMException("Browser work was cancelled.", "AbortError"))
process.on("SIGTERM", cancel)
process.on("SIGINT", cancel)
process.on("disconnect", cancel)
/** @param {unknown} value @param {boolean} [done] */
function send(value, done = false) {
  if (!Check(WorkerReplySchema, value)) throw new Error("The browser worker produced an invalid result.")
  if (!process.connected) {
    if (done) process.exit(0)
    return
  }
  process.send?.(value, error => {
    if (done) process.exit(error ? 1 : 0)
    else if (error) cancel() // Keep the process alive until browser cleanup settles.
  })
}
process.on("message", async value => {
  if (!Check(WorkerRequestSchema, value)) {
    send({ type: "error", name: "Error", message: "Invalid browser worker request." }, true)
    return
  }
  if (value.type === "cancel") {
    cancel()
    return
  }
  if (started) {
    cancel()
    return
  }
  started = true
  try {
    if (value.type === "render")
      send({ type: "render", results: await renderJobs({ ...value.input, signal: controller.signal }) }, true)
    else {
      const result = await checkJobs({
        ...value.input,
        signal: controller.signal,
        onProgress: progress => send({ type: "progress", progress }),
      })
      send({ type: "checks", ...result }, true)
    }
  } catch (error) {
    send(
      {
        type: "error",
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
      },
      true,
    )
  }
})
