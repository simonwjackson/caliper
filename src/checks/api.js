// @ts-check
import { NO_CHROMIUM } from "../render/chromium.js"
import { createHash, randomUUID } from "node:crypto"
import { lstatSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { Check } from "typebox/value"
import { json, readJson, refuse } from "../http.js"
import { CheckReportSchema } from "../render/check-contract.js"
import { approveBaselines, checkJobs } from "../render/checks.js"
import { planRenders } from "../render/plan.js"
import { takeParts } from "../takes/parts.js"
import { createSourceRevision } from "./source-revision.js"
import { ApproveCheckSchema, CancelCheckSchema, CheckProgressSchema, CheckRequestSchema } from "./contract.js"

/** @typedef {import('./contract.js').ChecksView} ChecksView */
/** @typedef {import('./contract.js').CheckRequest} CheckRequest */
/** @typedef {{ path: string, hash: string }} Artifact */
/** @param {Buffer | string} bytes */
const digest = bytes => createHash("sha256").update(bytes).digest("hex")
/** @param {unknown} error */
const reason = error => error instanceof Error ? error.message : String(error)

/**
 * Session-local reports. Saved evidence stays on disk, but is not loaded on restart.
 * No take acceptance path depends on this API.
 * @param {{
 * store: import('../takes/store.js').TakeStore,
 * project: () => Promise<import('../types').Project>,
 * serverUrl: () => string | null,
 * chromium: string | undefined,
 * cacheDir?: string,
 * onChange: () => void,
 * run?: typeof checkJobs,
 * }} input
 */
export function createChecksApi({ store, project, serverUrl, chromium, cacheDir, onChange, run = checkJobs }) {
  /** @type {ChecksView} */
  let view = { _tag: "Idle" }
  /** @type {{ id: string, report: Artifact, images: Map<string, Artifact>, fingerprint: string } | null} */
  let evidence = null
  /** @type {Promise<void> | null} */
  let pending = null
  /** @type {AbortController | null} */
  let controller = null
  let starting = false
  let closed = false
  let changed = false
  const root = resolve(store.root)
  const baselines = join(root, ".caliper", "baselines")
  const output = join(root, ".caliper", "checks")
  const source = createSourceRevision({ root, cacheDir, store })
  const fingerprint = source.fingerprint

  /** Refuse links in every storage ancestor, even links within the project.
   * @param {string} file @param {string} [boundary]
   */
  const safe = (file, boundary = root) => {
    const inside = relative(boundary, file)
    if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error("Artifact is outside its check storage.")
    let cursor = root
    for (const segment of relative(root, file).split(sep)) {
      cursor = join(cursor, segment)
      const stat = lstatSync(cursor, { throwIfNoEntry: false })
      if (stat?.isSymbolicLink()) throw new Error(`Unsafe symbolic link in check storage: ${cursor}.`)
      if (!stat) break
    }
    return file
  }

  const publish = () => { if (!closed) onChange() }
  /** @param {string} file */
  const invalidate = file => {
    if (closed) return
    const request = "request" in view ? view.request : {}
    const before = source.stamp(request).generation
    source.invalidate(file)
    if (view._tag === "Idle" || view._tag === "Failed" || view._tag === "Cancelled" || source.stamp(request).generation === before) return
    changed = true
    if (view._tag === "Ready" && !view.stale) {
      view = { ...view, stale: true }
      publish()
    }
  }
  /** @param {Artifact} artifact */
  const bytes = artifact => {
    const content = readFileSync(safe(artifact.path, output))
    if (digest(content) !== artifact.hash) throw new Error("Saved check evidence changed. Run checks and review again.")
    return content
  }

  /** @param {CheckRequest} request */
  const start = async request => {
    if (closed) throw new Error("The checks server is closing.")
    if (starting || pending !== null || view._tag === "Running") throw new Error("Checks are already running.")
    starting = true
    try {
      const original = await project()
      if (closed) throw new Error("The checks server is closing.")
      const viewed = request.take === undefined ? original : { ...original, parts: takeParts(store, request.take, original.parts) }
      const plan = planRenders(viewed, { ...request, devices: ["*"] })
      if (plan._tag === "Invalid") throw new Error(plan.reason)
      const before = fingerprint(request)
      const id = randomUUID()
      const out = safe(join(output, id))
      safe(baselines)
      changed = false
      controller = new AbortController()
      const signal = controller.signal
      evidence = null
      view = { _tag: "Running", id, request, startedAt: new Date().toISOString(), total: plan.jobs.length }
      const running = view
      publish()
      pending = (async () => {
        // Let the caller return Running before any synchronous runner failure.
        await Promise.resolve()
        try {
          if (!chromium) throw new Error(`Caliper cannot run checks. ${NO_CHROMIUM}`)
          const url = serverUrl()
          if (!url) throw new Error("The dev server is not listening yet.")
          const result = await run({ url, project: original.name, jobs: plan.jobs, out, executablePath: chromium, baselines, signal,
            onProgress: progress => {
              if (closed || view._tag !== "Running" || view.id !== id || !Check(CheckProgressSchema, progress)) return
              view = { ...view, progress }
              publish()
            },
          })
          if (closed) return
          const reportPath = safe(resolve(result.reportPath), out)
          const report = JSON.parse(readFileSync(reportPath, "utf8"))
          if (!Check(CheckReportSchema, report)) throw new Error("Invalid saved check report.")
          const partial = report.version === 2 && report.run.termination !== "Completed"
          const identities = new Set()
          if (report.project !== original.name || (!partial && report.results.length !== plan.jobs.length)
            || report.results.some(item => {
              const key = JSON.stringify([item.part, item.state, item.device, item.take])
              const duplicate = identities.has(key)
              identities.add(key)
              return duplicate || !plan.jobs.some(job => item.part === job.part && item.state === job.state && item.device === job.device && item.take === job.take)
            })) throw new Error("The check report does not match the requested states and devices.")
          /** @type {Map<string, Artifact>} */
          const images = new Map()
          for (const [index, item] of report.results.entries()) {
            for (const [kind, path, hash] of [["first", item.png, item.sha256], ["repeat", item.repeatPng, item.repeatSha256]]) {
              const file = safe(resolve(/** @type {string} */ (path)), out)
              if (digest(readFileSync(file)) !== hash) throw new Error("Report images changed during checks.")
              images.set(`${index}:${kind}`, { path: file, hash: /** @type {string} */ (hash) })
            }
            for (const [checkIndex, check] of (item.authored?.checks ?? []).entries()) {
              if (!check.image && !check.imageSha256) continue
              if (!check.image || !check.imageSha256 || !/^[a-f0-9]{64}$/.test(check.imageSha256)) throw new Error("Interaction evidence needs an image and its SHA-256 hash.")
              const file = safe(resolve(check.image), out)
              const content = readFileSync(file)
              if (!file.endsWith(".png") || !content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Interaction evidence must be a PNG image.")
              if (digest(content) !== check.imageSha256) throw new Error("Interaction evidence changed during checks.")
              images.set(`${index}:authored:${checkIndex}`, { path: file, hash: check.imageSha256 })
            }
            const baseline = item.checks.find(check => check.name === "baseline")
            if (baseline?.image) {
              const previous = readFileSync(safe(resolve(baseline.image), baselines))
              const copy = safe(join(dirname(reportPath), `baseline-${index}.png`), out)
              writeFileSync(copy, previous)
              baseline.image = copy
              images.set(`${index}:baseline`, { path: copy, hash: digest(previous) })
            }
          }
          // Save the copied baseline location, so later approval cannot rewrite history.
          writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
          let stale = changed || (report.version === 2 && report.run.stale)
          try { stale ||= before !== fingerprint(request) } catch { stale = true }
          evidence = { id, report: { path: reportPath, hash: digest(readFileSync(reportPath)) }, images, fingerprint: before }
          view = { _tag: "Ready", id, request, report, stale, approved: [] }
        } catch (error) {
          if (!closed) view = { _tag: error instanceof Error && error.name === "AbortError" ? "Cancelled" : "Failed", id, request, reason: reason(error) }
        } finally {
          controller = null
          pending = null
          publish()
        }
      })()
      return running
    } finally { starting = false }
  }

  /**
   * @param {string} path @param {URL} url
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   */
  const handle = async (path, url, request, response) => {
    if (!["/checks", "/checks/run", "/checks/cancel", "/checks/approve", "/checks/image", "/checks/report"].includes(path)) return false
    const write = path === "/checks/run" || path === "/checks/cancel" || path === "/checks/approve"
    if (request.method !== (write ? "POST" : "GET")) {
      json(response, 405, { error: write ? "Use POST." : "Use GET." })
      return true
    }
    const refusal = write ? refuse(request) : null
    if (refusal !== null) {
      json(response, 403, { error: refusal })
      return true
    }
    try {
      if (path === "/checks") json(response, 200, view)
      else if (path === "/checks/run") {
        const body = await readJson(request)
        if (!Check(CheckRequestSchema, body)) throw new Error("Name a part and state, with an optional take. No other fields are allowed.")
        if (starting || pending !== null) { json(response, 409, { error: "Checks are already running." }); return true }
        json(response, 202, await start(body))
      } else if (path === "/checks/cancel") {
        const body = await readJson(request)
        if (!Check(CancelCheckSchema, body)) throw new Error("Stop needs only the current run id.")
        if (view._tag !== "Running" || view.id !== body.id || controller === null) throw new Error("That run is no longer running.")
        view = { ...view, stopping: true }
        controller.abort(new DOMException("Stopped by user.", "AbortError"))
        publish()
        json(response, 202, view)
      } else if (path === "/checks/approve") {
        const body = await readJson(request)
        if (!Check(ApproveCheckSchema, body)) throw new Error("Approval needs a run id, an integer result index and reviewed: true.")
        if (view._tag !== "Ready" || evidence === null || body.id !== view.id || evidence.id !== view.id) throw new Error("That completed report is no longer current.")
        if (view.request.take !== undefined) throw new Error("Take images cannot become product baselines.")
        let stale = view.stale
        try { stale ||= fingerprint(view.request) !== evidence.fingerprint } catch { stale = true }
        if (stale) {
          view = { ...view, stale: true }
          publish()
          throw new Error("Sources changed. Run checks and review again before approving.")
        }
        bytes(evidence.report)
        const result = view.report.results[body.index]
        if (!result) throw new Error("That result does not exist.")
        for (const kind of ["first", "repeat", "baseline"]) {
          const artifact = evidence.images.get(`${body.index}:${kind}`)
          if (artifact) bytes(artifact)
        }
        safe(baselines)
        // Core approval validates the selected result, including both saved hashes.
        const selected = safe(join(dirname(evidence.report.path), "approval.json"), output)
        writeFileSync(selected, JSON.stringify({ ...view.report, results: [result] }))
        approveBaselines(selected, baselines)
        view = { ...view, approved: [...new Set([...view.approved, body.index])].sort((a, b) => a - b) }
        publish()
        json(response, 200, view)
      } else {
        if (!evidence || url.searchParams.get("id") !== evidence.id) { json(response, 404, { error: "No saved evidence for that run." }); return true }
        let artifact = evidence.report
        if (path === "/checks/image") {
          const index = url.searchParams.get("index") ?? ""
          const kind = url.searchParams.get("kind") ?? ""
          const checkIndex = url.searchParams.get("check") ?? ""
          const key = kind === "authored" && /^(0|[1-9][0-9]*)$/.test(checkIndex) ? `authored:${checkIndex}` : kind
          const allowed = ["first", "repeat", "baseline"].includes(kind) || kind === "authored" && key !== kind
          const image = /^(0|[1-9][0-9]*)$/.test(index) && allowed ? evidence.images.get(`${index}:${key}`) : undefined
          if (!image) { json(response, 404, { error: "That saved image is not available." }); return true }
          artifact = image
        }
        const content = bytes(artifact)
        response.writeHead(200, { "content-type": path === "/checks/image" ? "image/png" : "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff", ...(path === "/checks/report" ? { "content-disposition": `attachment; filename="checks-${evidence.id}.json"` } : {}) })
        response.end(content)
      }
    } catch (error) { json(response, 400, { error: reason(error) }) }
    return true
  }

  return {
    handle, invalidate,
    snapshot: () => view,
    close: async () => {
      closed = true
      controller?.abort(new DOMException("Checks server is closing.", "AbortError"))
      await pending
      source.close()
    },
  }
}
