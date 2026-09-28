// @ts-check
import { createHash, randomUUID } from "node:crypto"
import { mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { Type } from "typebox"
import { Check } from "typebox/value"
import { DEVICES } from "../client/device-frame.js"
import { bounded, openBrowserSession } from "../render/browser-session.js"

const InputSchema = Type.Object(
  {
    run: Type.String(),
    target: Type.String(),
    operation: Type.Union([Type.Literal("click"), Type.Literal("type"), Type.Literal("press")]),
    value: Type.Optional(Type.String({ maxLength: 4096 })),
  },
  { additionalProperties: false },
)
/** @typedef {import('./contract.js').AuthoredCase} AuthoredCase */
/** @typedef {import('./contract.js').AuthoredResult} AuthoredResult */
/** @param {unknown} error */
const message = error => (error instanceof Error ? error.message : String(error))
/** @param {string} name @param {string} detail */
function failure(name, detail) {
  const error = new Error(detail)
  error.name = name
  return error
}

/** Serial named checks, each in a fresh context on the existing product server.
 * @param {{url:string,jobs:readonly import('../render/plan.js').RenderJob[],out:string,executablePath:string,source:import('./contract.js').CheckSource,signal?:AbortSignal,onProgress?:(progress:{phase:string,completed:number,total:number})=>void}} input
 * @returns {Promise<{results:AuthoredResult[],failure?:string}>}
 */
export async function runAuthoredJobs({ url, jobs, out, executablePath, source, signal, onProgress }) {
  mkdirSync(out, { recursive: true })
  /** @type {Awaited<ReturnType<typeof openBrowserSession>> | undefined} */
  let session
  /** @type {AuthoredResult[]} */
  const results = jobs.map(() => ({
    status: /** @type {const} */ ("NotRun"),
    reason: "No authored checks are declared for this state.",
    checks: [],
    provenance: source.provenance,
  }))
  /** @type {AuthoredCase | undefined} */
  let activeCase
  /** @type {string | undefined} */
  let infrastructureFailure
  const total = jobs.reduce(
    (count, job) => count + (source.parts.find(part => part.file === job.part)?.authoredChecks[job.state]?.length ?? 0),
    0,
  )
  let completed = 0
  try {
    for (const [jobIndex, job] of jobs.entries()) {
      const collection = /** @type {AuthoredResult} */ (results[jobIndex])
      const part = source.parts.find(part => part.file === job.part)
      const declarations = part?.authoredChecks[job.state] ?? []
      /** @type {AuthoredCase[]} */
      const checks = collection.checks
      if (part?.authoredCheckProblems.length) {
        checks.push({
          name: "Check declaration",
          source: { file: job.part, line: 1 },
          status: "Failed",
          reason: "InvalidDeclaration",
          detail: part.authoredCheckProblems.join("\n"),
          durationMs: 0,
          errors: [],
        })
      } else
        for (const declaration of declarations) {
          const initial = {
            name: declaration.name,
            source: { file: job.part, line: declaration.line },
            durationMs: 0,
            errors: /** @type {string[]} */ ([]),
          }
          if (signal?.aborted) {
            checks.push({ ...initial, status: "NotRun", reason: "Interrupted", detail: message(signal.reason) })
            continue
          }
          /** @type {AuthoredCase} */
          const result = {
            ...initial,
            status: "Passed",
            reason: "Completed",
            detail: "The named check completed without an observed error.",
          }
          checks.push(result)
          activeCase = result
          onProgress?.({ phase: `Checking ${job.state}: ${declaration.name}`, completed, total })
          session ??= await openBrowserSession(executablePath, signal)
          const device = DEVICES.find(device => device.id === job.device)
          if (!device) throw new Error(`Unknown device ${job.device}`)
          const context = await bounded(
            () =>
              /** @type {NonNullable<typeof session>} */ (session).browser.newContext({
                viewport: { width: device.cssWidth, height: device.cssHeight },
                deviceScaleFactor: 1,
              }),
            { signal },
          )
          const started = Date.now()
          /** @type {import('playwright-core').Page | undefined} */
          let page
          let unsafeToCapture = false
          let observedCrash = false
          /** @type {Promise<void>|undefined} */
          let contextClosing
          const closeCheck = () => contextClosing ??= /** @type {NonNullable<typeof session>} */ (session).closeContext(context)
          try {
            await bounded(
              async operationSignal => {
                const controller = new AbortController()
                const combined = AbortSignal.any([operationSignal, controller.signal])
                page = await context.newPage()
                const activePage = page
                const run = randomUUID()
                const targetBinding = `caliperTarget_${run.replaceAll("-", "")}`
                const actionBinding = `caliperAction_${run.replaceAll("-", "")}`
                /** @type {Map<string,import('playwright-core').ElementHandle>} */
                const handles = new Map()
                let active = true
                const abortCheck = () => {
                  active = false
                  unsafeToCapture = true
                  void closeCheck().catch(() => {})
                }
                combined.addEventListener("abort", abortCheck, { once: true })
                if (combined.aborted) { abortCheck(); combined.throwIfAborted() }
                activePage.once("crash", () => {
                  observedCrash = true
                  controller.abort(failure("InfrastructureError", "Chromium's product page crashed."))
                })
                let busy = false
                let resolvingTarget = false
                let loaded = false
                /** @param {{page:import('playwright-core').Page,frame:import('playwright-core').Frame}} origin */
                const guard = origin => {
                  if (!active || combined.aborted) throw failure("InputError", "This check is no longer active.")
                  if (
                    origin.page !== activePage ||
                    origin.frame !== activePage.mainFrame() ||
                    new URL(origin.frame.url()).origin !== new URL(url).origin
                  )
                    throw failure("InputError", "Input came from another frame or origin.")
                }
                /** @param {import('playwright-core').ElementHandle} element */
                const valid = async element => {
                  const allowed = await element.evaluate(
                    node =>
                      node instanceof Element &&
                      node.ownerDocument === document &&
                      node.isConnected &&
                      document.body.contains(node) &&
                      !node.closest("#caliper-problem, #caliper-warning, #caliper-frame-config"),
                  )
                  if (!allowed)
                    throw failure(
                      "InputError",
                      "The target is detached, outside the product document, or a Caliper diagnostic. Re-query it before input.",
                    )
                }
                /** @param {import('playwright-core').ElementHandle} element */
                const focused = async element => {
                  await valid(element)
                  if (!(await element.evaluate(node => node.ownerDocument?.activeElement === node)))
                    throw failure(
                      "InputError",
                      "Focus left the intended input target. Partial input will not be replayed.",
                    )
                }
                activePage.on("pageerror", error => initial.errors.push(error.message))
                activePage.on("console", event => {
                  if (event.type() === "error") initial.errors.push(event.text())
                })
                activePage.on("framenavigated", frame => {
                  if (loaded && frame === activePage.mainFrame())
                    controller.abort(
                      failure("NavigationError", "The product document navigated or reloaded during its check."),
                    )
                })
                await activePage.exposeBinding(
                  targetBinding,
                  async (origin, handle) => {
                    let acquired = false
                    try {
                      guard(origin)
                      if (busy || resolvingTarget || handles.size)
                        throw failure("InputError", "Concurrent input is not supported.")
                      resolvingTarget = true
                      acquired = true
                      const element = handle.asElement()
                      if (!element) throw failure("InputError", "Input needs a DOM element.")
                      await valid(element)
                      guard(origin)
                      const token = randomUUID()
                      handles.set(token, element)
                      return token
                    } catch (error) {
                      await handle.dispose()
                      throw error
                    } finally {
                      if (acquired) resolvingTarget = false
                    }
                  },
                  { handle: true },
                )
                await activePage.exposeBinding(actionBinding, async (origin, payload) => {
                  guard(origin)
                  if (!Check(InputSchema, payload) || payload.run !== run)
                    throw failure("InputError", "Invalid input request or run identity.")
                  const element = handles.get(payload.target)
                  if (!element || busy) throw failure("InputError", "Expired input target or concurrent operation.")
                  busy = true
                  try {
                    await bounded(
                      async inputSignal => {
                        inputSignal.throwIfAborted()
                        await valid(element)
                        guard(origin)
                        inputSignal.throwIfAborted()
                        if (payload.operation === "click") await element.click({ timeout: 1800 })
                        else {
                          if (typeof payload.value !== "string")
                            throw failure("InputError", "Typing and key input need a string.")
                          guard(origin)
                          inputSignal.throwIfAborted()
                          await element.focus()
                          await focused(element)
                          guard(origin)
                          inputSignal.throwIfAborted()
                          if (payload.operation === "press") await activePage.keyboard.press(payload.value)
                          else
                            for (const character of payload.value) {
                              inputSignal.throwIfAborted()
                              await focused(element)
                              guard(origin)
                              inputSignal.throwIfAborted()
                              await activePage.keyboard.type(character)
                              await focused(element)
                            }
                        }
                      },
                      { signal: combined, timeout: 2000 },
                    )
                  } catch (error) {
                    const inputError = failure("InputError", message(error))
                    if (combined.aborted || error instanceof Error && error.name === "TimeoutError") controller.abort(inputError)
                    throw inputError
                  } finally {
                    busy = false
                    handles.delete(payload.target)
                    await element.dispose()
                  }
                })
                try {
                  const frame = new URL("/__caliper/frame", url)
                  frame.searchParams.set("part", job.part)
                  frame.searchParams.set("state", job.state)
                  if (job.take) frame.searchParams.set("take", job.take)
                  await activePage.goto(frame.href, { timeout: 15000 })
                  loaded = true
                  await bounded(
                    async () => {
                      await activePage.waitForFunction(() => {
                        const value = document.documentElement.dataset.caliperState
                        return value && value !== "Loading"
                      })
                      const state = await activePage.evaluate(() => document.documentElement.dataset.caliperState)
                      if (state === "Failed") throw new Error("The product frame failed before the check could run.")
                      await activePage.evaluate(
                        async request => {
                          const config = JSON.parse(
                            document.getElementById("caliper-frame-config")?.textContent ?? "{}",
                          )
                          const runtimeUrl = "/@id/__x00__caliper:check-runtime"
                          const runtime = await import(/* @vite-ignore */ runtimeUrl)
                          await runtime.runAuthoredCheck({ ...request, part: config.part })
                        },
                        { run, state: job.state, name: declaration.name, targetBinding, actionBinding },
                      )
                      if (busy || handles.size) throw new Error("The check finished with input still pending.")
                    },
                    { signal: combined },
                  )
                } finally {
                  active = false
                  combined.removeEventListener("abort", abortCheck)
                  // Disposal itself can stall on a non-yielding page; context teardown owns it.
                  for (const handle of handles.values()) void handle.dispose().catch(() => {})
                  handles.clear()
                }
              },
              { signal },
            )
            if (initial.errors.length)
              Object.assign(result, { status: "Failed", reason: "BrowserError", detail: initial.errors.join("\n") })
          } catch (error) {
            const detail = message(error)
            const name = error instanceof Error ? error.name : "Error"
            const infrastructure = observedCrash || !session.browser.isConnected() || Boolean(page?.isClosed() && !unsafeToCapture)
            if (infrastructure) infrastructureFailure = detail
            const interrupted = signal?.aborted || unsafeToCapture && name !== "TimeoutError" && name !== "InputError" || ["AbortError", "SourceChanged", "NavigationError"].includes(name)
            Object.assign(result, {
              status: infrastructure || interrupted ? "Inconclusive" : "Failed",
              reason: infrastructure ? "Infrastructure" : signal?.aborted
                ? "Interrupted"
                : name === "TimeoutError"
                  ? "Timeout"
                  : name === "NavigationError"
                    ? "Navigation"
                    : name === "InputError" || detail.includes("InputError")
                      ? "InputError"
                      : "CheckError",
              detail,
            })
          } finally {
            if (page && !signal?.aborted && !unsafeToCapture && !infrastructureFailure && result.reason !== "Timeout") {
              try {
                const id = createHash("sha256")
                  .update(JSON.stringify([job, declaration.name]))
                  .digest("hex")
                  .slice(0, 24)
                const image = join(out, `${id}.png`)
                await bounded(
                  () => /** @type {import('playwright-core').Page} */ (page).screenshot({ path: image, timeout: 1000 }),
                  { timeout: 1500 },
                )
                result.image = image
                result.imageSha256 = createHash("sha256").update(readFileSync(image)).digest("hex")
              } catch (error) {
                result.evidenceError = message(error)
              }
            }
            if (!result.image && !result.evidenceError) result.evidenceError = "Interaction screenshot omitted so interrupted browser work can be torn down immediately."
            try {
              await closeCheck()
            } finally {
              result.durationMs = Date.now() - started
            }
          }
          if (result.status === "Passed" && result.errors.length)
            Object.assign(result, { status: "Failed", reason: "BrowserError", detail: result.errors.join("\n") })
          activeCase = undefined
          if (infrastructureFailure) throw failure("InfrastructureError", infrastructureFailure)
          completed++
          onProgress?.({ phase: "Authored checks", completed, total })
        }
    }
  } catch (error) {
    infrastructureFailure = message(error)
    if (activeCase)
      Object.assign(activeCase, {
        status: activeCase.status === "Failed" ? "Failed" : "Inconclusive",
        reason: activeCase.status === "Failed" ? activeCase.reason : signal?.aborted ? "Interrupted" : "Infrastructure",
        detail: `${activeCase.detail}\n${message(error)}`,
      })
  }
  try {
    await session?.close()
  } catch (error) {
    infrastructureFailure = message(error)
    results[0]?.checks.push({
      name: "Browser cleanup",
      source: { file: jobs[0]?.part ?? "unknown", line: 1 },
      status: "Inconclusive",
      reason: "Infrastructure",
      detail: message(error),
      durationMs: 0,
      errors: [],
    })
  }
  for (const [index, result] of results.entries()) {
    const job = jobs[index]
    if (job && infrastructureFailure)
      for (const declaration of source.parts.find(part => part.file === job.part)?.authoredChecks[job.state] ?? []) {
        if (!result.checks.some(check => check.name === declaration.name))
          result.checks.push({
            name: declaration.name,
            source: { file: job.part, line: declaration.line },
            status: "NotRun",
            reason: "Interrupted",
            detail: infrastructureFailure,
            durationMs: 0,
            errors: [],
          })
      }
    result.status = result.checks.some(check => check.status === "Failed")
      ? "Failed"
      : result.checks.some(check => check.status === "Inconclusive")
        ? "Inconclusive"
        : !result.checks.length || result.checks.some(check => check.status === "NotRun")
          ? "NotRun"
          : "Passed"
    if (result.checks.length) result.reason = "Only the listed authored checks were evaluated."
  }
  return { results, ...(infrastructureFailure ? { failure: infrastructureFailure } : {}) }
}
