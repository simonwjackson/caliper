// @ts-check
import { expect, test } from "bun:test"
import { createServer } from "node:http"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Check } from "typebox/value"
import { createChecksApi } from "../src/checks/api.js"
import { ApproveCheckSchema, CheckRequestSchema, ChecksViewSchema } from "../src/checks/contract.js"
import { compareRenders } from "../src/render/checks.js"
import { CheckReportSchema } from "../src/render/check-contract.js"
import { createTakeStore } from "../src/takes/store.js"
import { manifest, withProject } from "./project-server.js"
import { STANDARD_DEVICES } from "../src/client/device-frame.js"

const part = "Button.part.tsx"
/** @type {import('../src/types').Project} */
const project = {
  name: "app", parts: [{ file: part, name: "Button", states: [{ export: "default", label: "Default" }, { export: "Busy", label: "Busy" }] }],
  entry: { _tag: "Failed", reason: "", hint: "" }, css: { _tag: "Failed", reason: "", hint: "" }, wrapper: { _tag: "Failed", reason: "", hint: "" }, devices: STANDARD_DEVICES.slice(0, 2),
}
const request = { part, state: "default" }

/** Real reports and files, with only Chromium execution replaced.
 * @param {Parameters<import('../src/render/checks.js').checkJobs>[0]} input
 */
async function savedRun({ project, jobs, out, baselines }) {
  mkdirSync(out, { recursive: true })
  /** @param {string} name @returns {import('../src/render/render.js').RenderResult[]} */
  const sample = name => jobs.map((job, index) => {
    const png = join(out, `${index}-${name}.png`)
    writeFileSync(png, `image:${job.state}:${job.device}`)
    return { ...job, png, viewport: { width: 640, height: 480 }, frame: "Rendered", problems: [], console: [], spill: null,
      environment: "test", accessibility: { _tag: "Complete", violations: [], incomplete: [] } }
  })
  const first = sample("first"), second = sample("repeat")
  const report = compareRenders({ project, first, second, baselines })
  const reportPath = join(out, "report.json")
  writeFileSync(reportPath, JSON.stringify(report))
  return { report, reportPath, results: first.map((item, index) => ({ ...item, checks: report.results[index]?.checks ?? [], checkReport: reportPath })) }
}

/** Saved v2 evidence independent of browser execution.
 * @param {Parameters<typeof savedRun>[0]} input
 * @param {import('../src/authored/contract.js').CheckRun['termination']} [termination]
 */
async function savedAuthoredRun(input, termination = "Completed") {
  const saved = await savedRun(input)
  const image = join(input.out, "interaction.png")
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64")
  writeFileSync(image, png)
  /** @type {import('../src/render/check-contract.js').CheckReport} */
  const report = {
    ...saved.report, version: 2,
    run: { id: "authored-run", termination, source: { epoch: "server", generation: 3, fingerprint: "revision" }, stale: termination === "SourceChanged" },
    results: saved.report.results.map(item => ({ ...item, authored: {
      status: "Failed", reason: "Assertion", provenance: { kind: "Original", files: [], changedDeclarations: [] },
      checks: [{ name: "Retry", source: { file: part, line: 2 }, status: "Failed", reason: "Assertion", detail: "Not visible", durationMs: 15, errors: [], image, imageSha256: createHash("sha256").update(png).digest("hex") }],
    } })),
  }
  if (!Check(CheckReportSchema, report)) throw new Error("Invalid fixture report")
  writeFileSync(saved.reportPath, JSON.stringify(report))
  return { ...saved, report }
}

/** @param {(f: Awaited<ReturnType<typeof setup>>) => Promise<void>} run */
async function fixture(run) {
  const f = await setup()
  try { await run(f) } finally { await f.close() }
}
async function setup() {
  const root = mkdtempSync(join(tmpdir(), "caliper-checks-api-"))
  writeFileSync(join(root, part), "export default () => <button />\nexport const Busy = () => <button />")
  const store = createTakeStore(root)
  /** @type {import('../src/checks/contract.js').ChecksView[]} */
  const events = []
  /** @type {{ run: typeof savedRun }} */
  const runner = { run: savedRun }
  const api = createChecksApi({ store, project: async () => project, chromium: "test", cacheDir: join(root, "optimizer-output"), serverUrl: () => "http://localhost", run: input => runner.run(input), onChange: () => events.push(structuredClone(api.snapshot())) })
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost")
    void api.handle(url.pathname, url, req, res).then(handled => { if (!handled) { res.writeHead(404); res.end() } })
  })
  await new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(undefined)))
  const address = /** @type {import('node:net').AddressInfo} */ (server.address())
  const url = `http://127.0.0.1:${address.port}`
  /** @param {string} path */
  const get = path => fetch(`${url}${path}`)
  /** @param {string} path @param {unknown} body @param {Record<string,string>} [headers] */
  const post = (path, body, headers = {}) => fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: url, ...headers }, body: JSON.stringify(body) })
  const ready = async () => {
    for (let count = 0; count < 100; count++) {
      const view = api.snapshot()
      if (view._tag === "Ready") return view
      if (view._tag === "Failed") throw new Error(view.reason)
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    throw new Error("Checks did not complete")
  }
  /** @param {import('../src/checks/contract.js').CheckRequest} [body] */
  const start = async (body = request) => { expect((await post("/checks/run", body)).status).toBe(202); return ready() }
  return { root, store, api, events, runner, get, post, ready, start, close: async () => {
    await api.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(() => resolve(undefined)))
    rmSync(root, { recursive: true, force: true })
  } }
}

test("checks schemas reject invented scope, unreviewed approval and invalid indices", () => {
  expect(Check(CheckRequestSchema, { part: "*", state: "*" })).toBe(true)
  for (const bad of [{ part }, { ...request, take: "0" }, { ...request, out: "/tmp" }, { ...request, state: "" }]) expect(Check(CheckRequestSchema, bad)).toBe(false)
  for (const index of [-1, 0.5, "0"]) expect(Check(ApproveCheckSchema, { id: crypto.randomUUID(), index, reviewed: true })).toBe(false)
  expect(Check(ApproveCheckSchema, { id: crypto.randomUUID(), index: 0, reviewed: false })).toBe(false)
  expect(Check(ChecksViewSchema, { _tag: "Idle" })).toBe(true)
})

test("HTTP run returns Running, publishes transitions and retains the Ready report across reloads", () => fixture(async f => {
  expect(await (await f.get("/checks")).json()).toEqual({ _tag: "Idle" })
  const response = await f.post("/checks/run", { part: "*", state: "*" })
  const running = await response.json()
  expect(response.status).toBe(202)
  expect(running._tag).toBe("Running")
  expect(running.total).toBe(4)
  expect(Check(ChecksViewSchema, running)).toBe(true)
  const ready = await f.ready()
  expect(Check(ChecksViewSchema, ready)).toBe(true)
  expect(f.events.map(event => event._tag)).toEqual(["Running", "Ready"])
  expect(await (await f.get("/checks")).json()).toEqual(ready)
  expect(await (await f.get("/checks")).json()).toEqual(ready)
  const report = await f.get(`/checks/report?id=${ready.id}`)
  expect(report.headers.get("content-disposition")).toContain("attachment")
  expect(await report.json()).toEqual(ready.report)
}))

test("write routes reject cross/null/malformed origins, wrong media types, methods and client file paths", () => fixture(async f => {
  for (const origin of ["null", "https://evil.test", "not a URL", "https://127.0.0.1"]) {
    expect((await f.post("/checks/run", request, { origin })).status).toBe(403)
    expect((await f.post("/checks/approve", {}, { origin })).status).toBe(403)
  }
  for (const type of ["text/plain", "application/json-evil"]) expect((await f.post("/checks/run", request, { "content-type": type })).status).toBe(403)
  expect((await f.get("/checks/run")).status).toBe(405)
  expect((await f.post("/checks", {})).status).toBe(405)
  for (const body of [null, {}, { ...request, baselines: "/tmp" }, { ...request, devices: ["iphone-16"] }, { part: "missing", state: "default" }]) expect((await f.post("/checks/run", body)).status).toBe(400)
  expect((await f.post("/checks/run", { ...request, take: "999" })).status).toBe(400)
  expect(f.api.snapshot()._tag).toBe("Idle")
}))

test("only allowlisted image indices and kinds are served; missing baseline and previous run return 404", () => fixture(async f => {
  const first = await f.start()
  expect(await (await f.get(`/checks/image?id=${first.id}&index=0&kind=first`)).text()).toBe("image:default:iphone-16")
  expect((await f.get(`/checks/image?id=${first.id}&index=0&kind=repeat`)).status).toBe(200)
  for (const suffix of ["index=0&kind=baseline", "index=-1&kind=first", "index=999&kind=first", "index=0&kind=../../package.json", "index=0.0&kind=first", "file=/etc/passwd"]) expect((await f.get(`/checks/image?id=${first.id}&${suffix}`)).status).toBe(404)
  await f.start()
  expect((await f.get(`/checks/report?id=${first.id}`)).status).toBe(404)
  expect((await f.get(`/checks/image?id=${first.id}&index=0&kind=first`)).status).toBe(404)
}))

test("starting another run immediately revokes previous image and report URLs, including after failure", () => fixture(async f => {
  const first = await f.start()
  let release = () => {}
  const gate = new Promise(resolve => { release = () => resolve(undefined) })
  f.runner.run = async () => { await gate; throw new Error("Render failed") }
  try {
    expect((await f.post("/checks/run", request)).status).toBe(202)
    expect(f.api.snapshot()._tag).toBe("Running")
    expect((await f.get(`/checks/image?id=${first.id}&index=0&kind=first`)).status).toBe(404)
    expect((await f.get(`/checks/report?id=${first.id}`)).status).toBe(404)
  } finally { release() }
  await new Promise(resolve => setTimeout(resolve, 5))
  expect(f.api.snapshot()._tag).toBe("Failed")
  expect((await f.get(`/checks/report?id=${first.id}`)).status).toBe(404)
}))

test("approval requires review, approves one device only, and preserves prior baseline evidence", () => fixture(async f => {
  const first = await f.start()
  for (const body of [{ id: first.id, index: 0 }, { id: first.id, index: -1, reviewed: true }, { id: first.id, index: 2, reviewed: true }, { id: "missing", index: 0, reviewed: true }]) expect((await f.post("/checks/approve", body)).status).toBe(400)
  const approved = await f.post("/checks/approve", { id: first.id, index: 0, reviewed: true })
  expect(approved.status).toBe(200)
  expect((await approved.json()).approved).toEqual([0])
  const baselineDir = join(f.root, ".caliper/baselines")
  expect(readdirSync(baselineDir).filter(name => name.endsWith(".json"))).toHaveLength(1)
  const second = await f.start()
  const imageUrl = `/checks/image?id=${second.id}&index=0&kind=baseline`
  expect(await (await f.get(imageUrl)).text()).toBe("image:default:iphone-16")
  expect((await f.post("/checks/approve", { id: second.id, index: 0, reviewed: true })).status).toBe(200)
  for (const file of readdirSync(baselineDir).filter(name => name.endsWith(".png"))) writeFileSync(join(baselineDir, file), "changed accepted baseline")
  expect(await (await f.get(imageUrl)).text()).toBe("image:default:iphone-16")
}))

test("watcher noise does not stale reports, but real changes stay visible and block approval", () => fixture(async f => {
  const ready = await f.start()
  for (const file of [".caliper/baselines/a.png", ".caliper/checks/report.json", "node_modules/a.js", "dist/out.js", ".git/index"]) f.api.invalidate(join(f.root, file))
  expect(f.api.snapshot()).toEqual(ready)
  f.api.invalidate(join(f.root, part))
  expect(f.api.snapshot()).toEqual({ ...ready, stale: true })
  expect((await f.post("/checks/approve", { id: ready.id, index: 0, reviewed: true })).status).toBe(400)
  expect((await (await f.get("/checks")).json()).report).toEqual(ready.report)
}))

test("Vite output, direnv caches and worktrees do not enter fingerprints or invalidate actual checks", () => fixture(async f => {
  const outputDirs = [".vite", "optimizer-output", ".direnv", ".worktree", ".worktrees"]
  const changeOutput = () => {
    for (const directory of outputDirs) {
      const folder = join(f.root, directory)
      mkdirSync(folder, { recursive: true })
      writeFileSync(join(folder, "generated.js"), crypto.randomUUID())
      f.api.invalidate(folder)
      f.api.invalidate(join(folder, "generated.js"))
    }
  }
  f.runner.run = async input => {
    const report = await savedRun(input)
    changeOutput()
    return report
  }
  const ready = await f.start()
  expect(ready.stale).toBe(false)
  changeOutput()
  expect(f.api.snapshot()).toEqual(ready)
  expect((await f.post("/checks/approve", { id: ready.id, index: 0, reviewed: true })).status).toBe(200)
  // A similarly named source is not part of the configured cache directory.
  writeFileSync(join(f.root, "optimizer-output-source.ts"), "export const source = true")
  expect((await f.post("/checks/approve", { id: ready.id, index: 1, reviewed: true })).status).toBe(400)
}))

test("exact source content catches missed watcher events, including file additions and deletions", () => fixture(async f => {
  for (const change of [() => writeFileSync(join(f.root, part), "export default () => null"), () => writeFileSync(join(f.root, "new.css"), "button {}"), () => rmSync(join(f.root, "new.css"))]) {
    const ready = await f.start()
    change()
    expect((await f.post("/checks/approve", { id: ready.id, index: 0, reviewed: true })).status).toBe(400)
    expect(f.api.snapshot()).toMatchObject({ _tag: "Ready", stale: true })
  }
}))

test("one concurrent run, source changes during execution stale completion, and shutdown waits safely", () => fixture(async f => {
  let release = () => {}
  const gate = new Promise(resolve => { release = () => resolve(undefined) })
  f.runner.run = async input => { await gate; return savedRun(input) }
  expect((await f.post("/checks/run", request)).status).toBe(202)
  expect((await f.post("/checks/run", request)).status).toBe(409)
  f.api.invalidate(join(f.root, part))
  release()
  expect((await f.ready()).stale).toBe(true)
  let finish = () => {}
  const stopGate = new Promise(resolve => { finish = () => resolve(undefined) })
  f.runner.run = async input => { await stopGate; return savedRun(input) }
  await f.post("/checks/run", request)
  const count = f.events.length
  let stopped = false
  const closing = f.api.close().then(() => { stopped = true })
  await new Promise(resolve => setTimeout(resolve, 5))
  expect(stopped).toBe(false)
  finish()
  await closing
  expect(f.events.length).toBe(count)
}))

test("take-only parts and states plan the real overlay; take approval is forbidden and take edits invalidate", () => fixture(async f => {
  const take = f.store.create({ ...request, device: "iphone-16" })
  f.store.write(take, "Alternate.part.tsx", "export default () => <div />; export const Alternate = () => <button />")
  const ready = await f.start({ part: "Alternate.part.tsx", state: "Alternate", take })
  expect(ready.report.results.map(item => item.state)).toEqual(["Alternate", "Alternate"])
  expect(ready.report.results.every(item => item.take === take)).toBe(true)
  expect((await f.post("/checks/approve", { id: ready.id, index: 0, reviewed: true })).status).toBe(400)
  f.api.invalidate(join(f.root, ".caliper/takes/999/Other.tsx"))
  expect(f.api.snapshot()).toEqual(ready)
  f.api.invalidate(join(f.root, `.caliper/takes/${take}/Alternate.part.tsx`))
  expect(f.api.snapshot()).toMatchObject({ stale: true })
}))

test("tampered images and reports cannot be served or approved", () => fixture(async f => {
  let ready = await f.start()
  writeFileSync(/** @type {string} */ (ready.report.results[0]?.png), "tampered")
  expect((await f.post("/checks/approve", { id: ready.id, index: 0, reviewed: true })).status).toBe(400)
  expect((await f.get(`/checks/image?id=${ready.id}&index=0&kind=first`)).status).toBe(400)
  ready = await f.start()
  const reportPath = join(f.root, ".caliper/checks", ready.id, "report.json")
  writeFileSync(reportPath, "{}")
  expect((await f.post("/checks/approve", { id: ready.id, index: 0, reviewed: true })).status).toBe(400)
  expect((await f.get(`/checks/report?id=${ready.id}`)).status).toBe(400)
}))

test("baseline and evidence storage cannot escape through symbolic links", () => fixture(async f => {
  const ready = await f.start()
  const outside = mkdtempSync(join(tmpdir(), "caliper-outside-"))
  try {
    symlinkSync(outside, join(f.root, ".caliper/baselines"))
    expect((await f.post("/checks/approve", { id: ready.id, index: 0, reviewed: true })).status).toBe(400)
    expect(readdirSync(outside)).toEqual([])
    expect((await f.post("/checks/run", request)).status).toBe(400)
    const image = /** @type {string} */ (ready.report.results[0]?.png)
    writeFileSync(join(outside, "secret"), readFileSync(image))
    rmSync(image)
    symlinkSync(join(outside, "secret"), image)
    expect((await f.get(`/checks/image?id=${ready.id}&index=0&kind=first`)).status).toBe(400)
  } finally { rmSync(outside, { recursive: true, force: true }) }
}))

test("completion detects unwatched source changes and rejects runner artifacts outside its directory", () => fixture(async f => {
  f.runner.run = async input => {
    const result = await savedRun(input)
    writeFileSync(join(f.root, "new-source.ts"), "export const changed = true")
    return result
  }
  expect((await f.start()).stale).toBe(true)
  f.runner.run = async input => {
    const result = await savedRun(input)
    const external = join(f.root, "not-a-check.png")
    writeFileSync(external, readFileSync(/** @type {string} */ (result.report.results[0]?.png)))
    if (result.report.results[0]) result.report.results[0].png = external
    writeFileSync(result.reportPath, JSON.stringify(result.report))
    return result
  }
  expect((await f.post("/checks/run", request)).status).toBe(202)
  await new Promise(resolve => setTimeout(resolve, 5))
  expect(f.api.snapshot()).toMatchObject({ _tag: "Failed" })
}))

test("runner failures publish Failed instead of hiding errors", () => fixture(async f => {
  f.runner.run = async () => { throw new Error("Chromium unavailable") }
  const response = await f.post("/checks/run", request)
  expect((await response.json())._tag).toBe("Running")
  await new Promise(resolve => setTimeout(resolve, 5))
  expect(await (await f.get("/checks")).json()).toMatchObject({ _tag: "Failed", reason: "Chromium unavailable" })
  expect(f.events.map(event => event._tag)).toEqual(["Running", "Failed"])
}))

test("Vite wires the checks API and sends its snapshot on the shared SSE stream without a model", () => withProject({ files: { "package.json": manifest(), "src/index.ts": "export {}", "Button.part.tsx": "export default () => null" } }, async ({ get }) => {
  expect(await (await get("/__caliper/checks")).json()).toEqual({ _tag: "Idle" })
  const events = await get("/__caliper/events")
  const reader = events.body?.getReader()
  expect(reader).toBeDefined()
  let text = ""
  try {
    while (!text.includes("event: checks")) {
      const chunk = await reader?.read()
      if (chunk?.done) break
      text += new TextDecoder().decode(chunk?.value)
    }
    expect(text).toContain('event: checks\ndata: {"_tag":"Idle"}')
  } finally { await reader?.cancel() }
}))

test("Stop aborts the runner, reports progress and preserves a distinct cancelled outcome", () => fixture(async f => {
  let aborted = false
  f.runner.run = async input => {
    input.onProgress?.({ phase: "First render", completed: 0, total: 2 })
    await new Promise((_resolve, reject) => {
      input.signal?.addEventListener("abort", () => { aborted = true; reject(Object.assign(new Error("Stopped by user"), { name: "AbortError" })) }, { once: true })
    })
    return savedRun(input)
  }
  const running = await (await f.post("/checks/run", request)).json()
  expect(f.api.snapshot()).toMatchObject({ _tag: "Running", progress: { phase: "First render", completed: 0, total: 2 } })
  expect((await f.get("/checks/cancel")).status).toBe(405)
  expect((await f.post("/checks/cancel", { id: running.id }, { origin: "https://evil.test" })).status).toBe(403)
  expect((await f.post("/checks/cancel", { id: crypto.randomUUID() })).status).toBe(400)
  expect((await f.post("/checks/cancel", { id: running.id, path: "/tmp" })).status).toBe(400)
  expect((await f.post("/checks/cancel", { id: running.id })).status).toBe(202)
  await new Promise(resolve => setTimeout(resolve, 5))
  expect(aborted).toBe(true)
  expect(f.api.snapshot()).toMatchObject({ _tag: "Cancelled", id: running.id })
  expect(Check(ChecksViewSchema, f.api.snapshot())).toBe(true)
  expect((await f.get(`/checks/report?id=${running.id}`)).status).toBe(404)
}))

test("shutdown aborts before waiting for runner cleanup", () => fixture(async f => {
  let aborted = false
  f.runner.run = async input => {
    await new Promise((_resolve, reject) => {
      input.signal?.addEventListener("abort", () => { aborted = true; reject(Object.assign(new Error("Shutdown"), { name: "AbortError" })) }, { once: true })
    })
    return savedRun(input)
  }
  await f.post("/checks/run", request)
  await f.api.close()
  expect(aborted).toBe(true)
}))

test("saved v1 reports remain readable and eligible for initial-image approval", () => fixture(async f => {
  f.runner.run = async input => {
    const saved = await savedRun(input)
    const legacy = { ...saved.report, version: 1, results: saved.report.results.map(result => ({ ...result, authored: undefined })) }
    writeFileSync(saved.reportPath, JSON.stringify(legacy))
    return saved
  }
  const ready = await f.start()
  expect(ready.report.version).toBe(1)
  expect(ready.report.results.every(result => result.authored === undefined)).toBe(true)
  expect((await f.post("/checks/approve", { id: ready.id, index: 0, reviewed: true })).status).toBe(200)
}))

test("v2 serves hashed interaction PNGs separately and approves only the initial image", () => fixture(async f => {
  f.runner.run = savedAuthoredRun
  const ready = await f.start()
  expect(ready.report.version).toBe(2)
  expect(Check(ChecksViewSchema, ready)).toBe(true)
  const imageUrl = `/checks/image?id=${ready.id}&index=0&kind=authored&check=0`
  const image = await f.get(imageUrl)
  expect(image.status).toBe(200)
  expect(image.headers.get("content-type")).toBe("image/png")
  expect((await image.arrayBuffer()).byteLength).toBeGreaterThan(8)
  for (const check of ["-1", "0.0", "999", "../../secret"]) expect((await f.get(`/checks/image?id=${ready.id}&index=0&kind=authored&check=${check}`)).status).toBe(404)
  expect((await f.post("/checks/approve", { id: ready.id, index: 0, reviewed: true, check: 0 })).status).toBe(400)
  expect((await f.post("/checks/approve", { id: ready.id, index: 0, reviewed: true })).status).toBe(200)
  const directory = join(f.root, ".caliper/baselines")
  const baseline = readdirSync(directory).find(name => name.endsWith(".png"))
  expect(readFileSync(join(directory, baseline ?? "missing"), "utf8")).toBe("image:default:iphone-16")
  const path = ready.report.results[0]?.authored?.checks[0]?.image
  if (!path) throw new Error("Missing interaction image")
  writeFileSync(path, "tampered")
  expect((await f.get(imageUrl)).status).toBe(400)
}))

test("Stop retains completed observations from an interrupted partial v2 report", () => fixture(async f => {
  f.runner.run = async input => {
    const saved = await savedAuthoredRun(input, "Cancelled")
    saved.report.results = saved.report.results.slice(0, 1)
    writeFileSync(saved.reportPath, JSON.stringify(saved.report))
    await new Promise(resolve => input.signal?.addEventListener("abort", () => resolve(undefined), { once: true }))
    return saved
  }
  const running = await (await f.post("/checks/run", request)).json()
  expect((await f.post("/checks/cancel", { id: running.id })).status).toBe(202)
  const ready = await f.ready()
  expect(ready.report).toMatchObject({ version: 2, run: { termination: "Cancelled", stale: false } })
  expect(ready.report.results).toHaveLength(1)
  expect(ready.report.results[0]?.authored?.checks[0]?.status).toBe("Failed")
  expect((await f.get(`/checks/image?id=${ready.id}&index=0&kind=first`)).status).toBe(200)
}))

test("source-invalidated reports retain stale provenance and cannot approve images", () => fixture(async f => {
  f.runner.run = input => savedAuthoredRun(input, "SourceChanged")
  const ready = await f.start()
  expect(ready.stale).toBe(true)
  expect(ready.report).toMatchObject({ version: 2, run: { termination: "SourceChanged", stale: true } })
  expect((await f.post("/checks/approve", { id: ready.id, index: 0, reviewed: true })).status).toBe(400)
}))

test("interaction evidence rejects untrusted paths, missing hashes and non-PNG files", () => fixture(async f => {
  for (const kind of ["outside", "symlink", "hash", "missing", "not-png"]) {
    f.runner.run = async input => {
      const saved = await savedAuthoredRun(input)
      /** @type {import('../src/authored/contract.js').AuthoredCase | undefined} */
      const check = saved.report.results[0]?.authored?.checks[0]
      if (!check?.image) throw new Error("Missing interaction image")
      if (kind === "hash") check.imageSha256 = "0".repeat(64)
      if (kind === "missing") delete check.imageSha256
      if (kind === "outside" || kind === "symlink") {
        const external = join(f.root, "external.png")
        writeFileSync(external, readFileSync(check.image))
        if (kind === "outside") check.image = external
        else { rmSync(check.image); symlinkSync(external, check.image) }
      }
      if (kind === "not-png") {
        writeFileSync(check.image, "not a PNG")
        check.imageSha256 = createHash("sha256").update("not a PNG").digest("hex")
      }
      writeFileSync(saved.reportPath, JSON.stringify(saved.report))
      return saved
    }
    const running = await (await f.post("/checks/run", request)).json()
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(f.api.snapshot()).toMatchObject({ _tag: "Failed" })
    expect((await f.get(`/checks/image?id=${running.id}&index=0&kind=authored&check=0`)).status).toBe(404)
  }
}))
