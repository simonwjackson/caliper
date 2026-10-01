// @ts-check
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createAgentHosts } from "../src/central/agents.js"
import { createTakeAgents } from "../src/agent/take-agents.js"
import { remoteHost } from "../src/central/remote-host.js"
import { createHostApi } from "../src/host/api.js"
import { createTakeStore } from "../src/takes/store.js"
import { createMarkStore, StaleDraft } from "../src/takes/marks.js"
import { createIntegrationReview } from "../src/takes/integration.js"
import { STANDARD_DEVICES } from "../src/client/device-frame.js"

const ask = { part: "src/Chip.part.tsx", state: "default", device: "iphone-16" }

/**
 * A real plugin host with configurable delayed answers. Only the selected
 * call waits; the host continues answering the worker's other calls.
 * @param {{ target: string, method: string, phase?: "reply", after?: number } | null} [slow]
 */
async function delayedHost(slow = { target: "store", method: "overview" }) {
  const root = mkdtempSync(join(tmpdir(), "caliper-agent-host-"))
  mkdirSync(join(root, "src"))
  writeFileSync(join(root, ask.part), "export default function Chip() { return <button>Chip</button> }\n")
  const store = createTakeStore(root)
  const marks = createMarkStore(root)
  const integration = createIntegrationReview(store)
  const api = createHostApi({ store, marks, integration, root, home: root })
  const entered = Promise.withResolvers()
  const release = Promise.withResolvers()
  const project = { name: "test", devices: STANDARD_DEVICES, parts: [{ file: ask.part, name: "Chip", states: [{ export: "default", name: "Default" }] }] }
  let projectReads = 0
  const server = createServer(async (request, response) => {
    if (request.url?.endsWith("project.json")) {
      projectReads += 1
      if (slow?.target === "project" && projectReads > (slow.after ?? 0)) {
        entered.resolve(undefined)
        await release.promise
      }
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify(project))
      return
    }
    if (request.headers["x-caliper-delay"] === "yes") {
      entered.resolve(undefined)
      await release.promise
    }
    await api.handle(request, response)
  })
  await new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(undefined)))
  const port = /** @type {import("node:net").AddressInfo} */ (server.address()).port
  const url = `http://127.0.0.1:${port}/`
  /** @type {string[]} */
  const calls = []
  /** @param {string} target @param {string} method @param {unknown} args @param {AbortSignal} [signal] */
  const call = async (target, method, args, signal) => {
    calls.push(`${target}.${method}`)
    const held = slow?.target === target && slow.method === method && calls.filter(call => call === `${target}.${method}`).length > (slow.after ?? 0)
    if (target === "app") {
      if (held) { entered.resolve(undefined); await release.promise }
      return { id: 0, value: { url, base: "/" } }
    }
    const response = await fetch(`${url}__caliper/host`, {
      method: "POST", headers: { "content-type": "application/json", "x-caliper-delay": slow?.phase !== "reply" && held ? "yes" : "no" },
      body: JSON.stringify({ target, method, args }), ...(signal ? { signal } : {}),
    })
    const value = await response.json()
    if (slow?.phase === "reply" && held) {
      entered.resolve(undefined)
      await release.promise
    }
    return { id: 0, ...value }
  }
  const hosts = createAgentHosts({ stateDir: root, agent: () => undefined, env: {}, hostCall: (_id, target, method, args, signal) => call(target, method, args, signal) })
  return {
    host: hosts.get("test", root), remote: remoteHost({ call, root }), store, marks, root, calls, entered: entered.promise,
    release: () => release.resolve(undefined),
    close: async () => {
      release.resolve(undefined)
      await hosts.close()
      server.closeAllConnections()
      await new Promise(resolve => server.close(() => resolve(undefined)))
      rmSync(root, { recursive: true, force: true })
    },
  }
}

test("a worker answers another message while a take-store host call waits", async () => {
  const fixture = await delayedHost()
  try {
    const snapshot = fixture.host.snapshot()
    await fixture.entered
    let timer
    const answer = await Promise.race([
      fixture.host.editable("1").then(error => ({ kind: "answered", error })),
      new Promise(resolve => { timer = setTimeout(() => resolve({ kind: "blocked" }), 200) }),
    ])
    clearTimeout(timer)
    fixture.release()
    await snapshot
    expect(answer).toEqual({ kind: "answered", error: null })
  } finally { await fixture.close() }
})

test("Stop aborts a running take's slow host call before the host answers", async () => {
  const fixture = await delayedHost({ target: "store", method: "addImages" })
  const finalUpdate = Promise.withResolvers()
  const unsubscribe = fixture.host.subscribe(event => {
    if (event.type === "takes" && /** @type {import("../src/types").TakesSnapshot} */ (event.data).takes[0]?.run._tag === "Failed") finalUpdate.resolve(event.data)
  })
  try {
    const response = await fixture.host.request({ path: "/takes", method: "POST", headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify({ ...ask, prompt: "Change it" })) })
    expect(response.status).toBe(201)
    const { take } = JSON.parse(response.body.toString())
    await fixture.entered
    const stopped = await fixture.host.request({ path: `/takes/${take}/stop`, method: "POST", headers: { "content-type": "application/json" }, body: Buffer.from("{}") })
    expect(stopped.status).toBe(200)
    const snapshot = /** @type {import("../src/types").TakesSnapshot} */ ((await fixture.host.snapshot()).takes)
    expect(snapshot.takes[0]?.run).toEqual({ _tag: "Failed", reason: "The take was stopped." })
    expect(fixture.calls).not.toContain("store.read")
    expect(/** @type {import("../src/types").TakesSnapshot} */ (await finalUpdate.promise).takes[0]?.run).toEqual({ _tag: "Failed", reason: "The take was stopped." })
    fixture.release()
  } finally { unsubscribe(); await fixture.close() }
}, 5000)

test("each concurrent worker snapshot reads all take metadata in one overview", async () => {
  const fixture = await delayedHost({ target: "store", method: "overview", phase: "reply" })
  try {
    fixture.store.create(ask)
    const first = fixture.host.snapshot()
    await fixture.entered
    createIntegrationReview(fixture.store).begin("1")
    const second = fixture.host.snapshot()
    fixture.release()
    const snapshots = await Promise.all([first, second])
    expect(snapshots.map(snapshot => /** @type {import("../src/types").TakesSnapshot} */ (snapshot.takes).takes.length)).toEqual([1, 2])
    expect(fixture.calls.filter(call => call.startsWith("store."))).toEqual(["store.overview", "store.overview"])
    expect(fixture.calls).not.toContain("integration.summary")
  } finally { await fixture.close() }
})

test("remote calls retain the plugin's disk fence and StaleDraft identity", async () => {
  const fixture = await delayedHost(null)
  try {
    const { remote } = fixture
    const take = await remote.store.create(ask)
    await remote.store.write(take, ask.part, "take copy")
    expect(await remote.store.read(take, ask.part)).toBe("take copy")
    expect(readFileSync(join(fixture.root, ask.part), "utf8")).toContain("Chip")
    await expect(remote.store.write(take, "../outside.ts", "bad")).rejects.toThrow("outside the project")
    await expect(remote.store.write(take, ".env", "secret")).rejects.toThrow("environment file")
    const draft = await remote.marks.read()
    await expect(remote.marks.current(draft.revision + 1)).rejects.toBeInstanceOf(StaleDraft)
    try { await remote.marks.current(draft.revision + 1) } catch (error) {
      expect(/** @type {StaleDraft} */ (error).draft).toEqual(draft)
    }
  } finally { await fixture.close() }
})

test("remote integration awaits beginCheck, retains failure, and releases the check fence", async () => {
  const fixture = await delayedHost({ target: "integration", method: "beginCheck" })
  try {
    const { remote } = fixture
    const source = await remote.store.create(ask)
    await remote.store.write(source, ask.part, "export default function Chip() {}\nexport function Quiet() {}\n")
    const take = await remote.integration.begin(source)
    await remote.integration.submit(take, { strategy: "variant", summary: "Quiet", shared: "Behavior", preserved: "Default", usage: "Quiet", preview: { part: ask.part, state: "Quiet" } })
    let verified = false
    const checked = remote.integration.check(take, async () => { verified = true; throw new Error("render failed") })
    await fixture.entered
    expect(verified).toBe(false)
    fixture.release()
    expect((await checked).checks).toEqual({ _tag: "Failed", reason: "render failed" })
    const revision = await remote.integration.beginCheck(take)
    await expect(remote.integration.beginCheck(take)).rejects.toThrow("check in progress")
    const finished = await remote.integration.finishCheck(take, revision, { summary: "Rendered successfully" })
    expect(finished.checks._tag).toBe("Passed")
    expect(await remote.integration.apply(take, finished.revision, true)).toEqual([ask.part])
  } finally { await fixture.close() }
})


test("a take change during a snapshot cannot broadcast the older agent settings", async () => {
  const fixture = await delayedHost({ target: "store", method: "overview", phase: "reply" })
  /** @type {string[]} */
  const statuses = []
  const delivered = Promise.withResolvers()
  const unsubscribe = fixture.host.subscribe(event => {
    if (event.type !== "takes") return
    const status = /** @type {import("../src/types").TakesSnapshot} */ (event.data).agent._tag
    statuses.push(status)
    delivered.resolve(undefined)
  })
  try {
    fixture.host.edit("1", "src/Chip.part.tsx")
    await fixture.entered
    fixture.host.reconfigure({ model: "bad" })
    // A reply proves the worker processed the model change before releasing the read.
    await fixture.host.editable("2")
    fixture.release()
    await delivered.promise
    expect(statuses).toEqual(["Failed"])
  } finally { unsubscribe(); await fixture.close() }
})

test("overlapping async batches keep their own overview across awaits", async () => {
  const fixture = await delayedHost(null)
  try {
    const { store } = fixture.remote
    const firstTake = await store.create(ask)
    const entered = Promise.withResolvers()
    const release = Promise.withResolvers()
    const first = store.batch(async () => {
      expect(await store.list()).toEqual([firstTake])
      entered.resolve(undefined)
      await release.promise
      expect(await store.list()).toEqual([firstTake])
      return store.batch(async () => store.files(firstTake))
    })
    await entered.promise
    await store.create(ask)
    const second = await store.batch(async () => store.list())
    expect(second).toEqual(["1", "2"])
    release.resolve(undefined)
    expect(await first).toEqual([])
    expect(await store.list()).toEqual(["1", "2"])
    expect(fixture.calls.filter(call => call === "store.overview")).toHaveLength(2)
    await expect(store.batch(async () => { throw new Error("reader failed") })).rejects.toThrow("reader failed")
    expect(await store.list()).toEqual(["1", "2"])
  } finally { await fixture.close() }
})


for (const slow of [{ target: "app", method: "server", after: 1 }, { target: "project", method: "json", after: 1 }]) {
  test(`Stop also aborts the running take's ${slow.target}.${slow.method} read`, async () => {
    const fixture = await delayedHost(slow)
    try {
      const started = await fixture.host.request({ path: "/takes", method: "POST", headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify({ ...ask, prompt: "Change it" })) })
      expect(started.status).toBe(201)
      const { take } = JSON.parse(started.body.toString())
      await fixture.entered
      const stopping = fixture.host.request({ path: `/takes/${take}/stop`, method: "POST", headers: { "content-type": "application/json" }, body: Buffer.from("{}") })
      let timer
      const answer = await Promise.race([
        stopping.then(response => response.status),
        new Promise(resolve => { timer = setTimeout(() => resolve("blocked"), 200) }),
      ])
      clearTimeout(timer)
      fixture.release()
      await stopping
      expect(answer).toBe(200)
      const snapshot = /** @type {import("../src/types").TakesSnapshot} */ ((await fixture.host.snapshot()).takes)
      expect(snapshot.takes[0]?.run).toEqual({ _tag: "Failed", reason: "The take was stopped." })
    } finally { await fixture.close() }
  })
}


test("a held creation reply cannot let another request discard and reuse Send's child", async () => {
  const fixture = await delayedHost({ target: "store", method: "fork", phase: "reply" })
  const agents = createTakeAgents({ store: fixture.remote.store, integration: fixture.remote.integration, engine: () => { throw new Error("No model needed") }, renderFor: () => async () => [], onChange: () => {} })
  try {
    const source = await fixture.remote.store.create(ask)
    const forked = agents.fork(source, ask)
    await fixture.entered
    const discarded = agents.discard("2").then(() => "discarded", error => error.message)
    let timer
    const outcome = await Promise.race([discarded, new Promise(resolve => { timer = setTimeout(() => resolve("waiting"), 100) })])
    clearTimeout(timer)
    fixture.release()
    const child = await forked
    expect(outcome).not.toBe("discarded")
    expect(await discarded).toContain("being changed")
    await agents.discardPrepared(child)
    expect(await fixture.remote.store.list()).toEqual([source])
  } finally { fixture.release(); await agents.close(); await fixture.close() }
})

test("a held accept membership read cannot leave a newly forked chain member behind", async () => {
  const fixture = await delayedHost({ target: "store", method: "list", phase: "reply" })
  const agents = createTakeAgents({ store: fixture.remote.store, integration: fixture.remote.integration, engine: () => { throw new Error("No model needed") }, renderFor: () => async () => [], onChange: () => {} })
  try {
    const one = fixture.store.create(ask)
    const identity = { take: one, created: /** @type {number} */ (fixture.store.record(one)?.created) }
    const two = fixture.store.fork(one, { ...ask, parent: identity, chain: identity })
    const accepting = agents.accept(one)
    await fixture.entered
    const forked = agents.fork(two, { ...ask, parent: { take: two, created: /** @type {number} */ (fixture.store.record(two)?.created) }, chain: identity }).then(take => ({ take }), error => ({ error: error.message }))
    let timer
    const outcome = await Promise.race([forked, new Promise(resolve => { timer = setTimeout(() => resolve(null), 100) })])
    clearTimeout(timer)
    if (outcome && "take" in outcome) { await agents.startMarkup(outcome.take, "Brief", []); await agents.stop(outcome.take) }
    fixture.release()
    await accepting
    await forked
    expect(fixture.store.list()).toEqual([])
  } finally { fixture.release(); await agents.close(); await fixture.close() }
})


test("a held alternate allocation reply cannot launch in a reused take number", async () => {
  const fixture = await delayedHost({ target: "integration", method: "begin", phase: "reply" })
  const agents = createTakeAgents({ store: fixture.remote.store, integration: fixture.remote.integration, engine: () => { throw new Error("No model needed") }, renderFor: () => async () => [], onChange: () => {} })
  try {
    const source = await fixture.remote.store.create(ask)
    const alternate = agents.alternate(source)
    await fixture.entered
    const discarded = agents.discard("2").then(() => "discarded", error => error.message)
    let timer
    const outcome = await Promise.race([discarded, new Promise(resolve => { timer = setTimeout(() => resolve("waiting"), 100) })])
    clearTimeout(timer)
    if (outcome === "discarded") await agents.start({ ...ask, prompt: "Unrelated take" })
    fixture.release()
    await alternate
    await discarded
    expect(outcome).not.toBe("discarded")
    await agents.stop("2")
  } finally { fixture.release(); await agents.close(); await fixture.close() }
})
