// @ts-check
import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai"
import { createTakeStore } from "../src/takes/store.js"
import { createTakeAgents } from "../src/agent/take-agents.js"
import { takeTools } from "../src/agent/tools.js"

function deferred() {
  /** @type {() => void} */
  let resolve = () => {}
  const promise = new Promise(/** @param {(value: void) => void} done */ done => { resolve = done })
  return { promise, resolve }
}

const ask = { part: "Example.part.tsx", state: "default", device: "iphone-16" }

/** @param {(root: string, store: ReturnType<typeof createTakeStore>) => Promise<void>} run */
async function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "caliper-agent-authored-"))
  writeFileSync(join(root, ask.part), "export default function Example() { return null }")
  try { await run(root, createTakeStore(root)) }
  finally { rmSync(root, { recursive: true, force: true }) }
}

test("render forwards the SDK AbortSignal, retains authored evidence, and gives initial images priority", async () => {
  await fixture(async (root, store) => {
    const take = store.create(ask)
    const signal = new AbortController().signal
    /** @type {AbortSignal | undefined} */
    let received
    const png = join(root, "initial.png")
    const image = join(root, "interaction.png")
    writeFileSync(png, "initial")
    writeFileSync(image, "interaction")
    const authored = { status: /** @type {const} */ ("Passed"), reason: "Completed", provenance: { kind: /** @type {const} */ ("Take"), take, files: [], changedDeclarations: [] }, checks: [{ name: "retry", source: { file: ask.part, line: 2 }, status: /** @type {const} */ ("Passed"), reason: "Completed", detail: "", durationMs: 10, errors: [], image }] }
    const tool = takeTools({ store, take, defaults: ask, render: async request => {
      received = request.signal
      return Array.from({ length: 3 }, (_, index) => ({ ...ask, state: `State${index}`, viewport: { width: 640, height: 480 }, frame: /** @type {const} */ ("Rendered"), png, problems: [], console: [], spill: null, authored, checkRun: { id: "run", termination: /** @type {const} */ ("SourceChanged"), stale: true, source: { epoch: "server", generation: 1, fingerprint: "source" } }, checkReport: join(root, "report.json") }))
    } }).find(tool => tool.name === "render")
    const result = await tool?.execute("call", { checks: true }, signal)
    expect(received).toBe(signal)
    const images = result?.content.filter(block => block.type === "image")
    expect(images?.map(block => block.data)).toEqual(["initial", "initial", "initial", "interaction"].map(value => Buffer.from(value).toString("base64")))
    expect(result?.content[0]).toMatchObject({ type: "text" })
    expect(JSON.stringify(result?.details)).toContain(image)
    expect(JSON.stringify(result?.details)).toContain(png)
    expect(JSON.stringify(result?.details)).toContain("report.json")
    expect(JSON.stringify(result?.details)).toContain('"termination":"SourceChanged"')
    expect(JSON.stringify(result?.details)).toContain('"stale":true')
    expect(JSON.stringify(result?.content[0])).toContain("omitted")
  })
})

for (const stage of ["initial render", "checks tool"]) {
  test(`Stop waits for cleanup during ${stage} and prevents later model work`, async () => {
    await fixture(async (_root, store) => {
      const faux = fauxProvider({ models: [{ id: "scripted", input: ["text", "image"] }] })
      const models = createModels()
      models.setProvider(faux.provider)
      let followup = false
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("render", { checks: true })], { stopReason: "toolUse" }),
        () => { followup = true; return fauxAssistantMessage([fauxText("Must not run")]) },
      ])
      const entered = deferred()
      const cleanup = deferred()
      /** @type {AbortSignal | undefined} */
      let received
      const agents = createTakeAgents({ store, engine: () => ({ models, model: faux.getModel(), reasoning: "off" }), onChange: () => {}, renderFor: () => async request => {
        if (stage === "checks tool" && !request.checks) return []
        received = request.signal
        entered.resolve()
        await cleanup.promise
        received?.throwIfAborted()
        return []
      } })
      const take = await agents.start({ ...ask, prompt: "Check it" })
      await entered.promise
      try {
        expect(received).toBeInstanceOf(AbortSignal)
        let stopped = false
        const stopping = agents.stop(take).then(() => { stopped = true })
        expect(received?.aborted).toBe(true)
        await Promise.resolve()
        expect(stopped).toBe(false)
        expect((await agents.views())[0]?.run._tag).toBe("Running")
        cleanup.resolve()
        await stopping
        expect((await agents.views())[0]?.run._tag).not.toBe("Running")
        expect(followup).toBe(false)
      } finally { cleanup.resolve() }
    })
  })
}

test("close aborts all active takes and waits for all render cleanup", async () => {
  await fixture(async (_root, store) => {
    const faux = fauxProvider({ models: [{ id: "scripted", input: ["text", "image"] }] })
    const models = createModels()
    models.setProvider(faux.provider)
    const cleanup = deferred()
    const entered = deferred()
    /** @type {AbortSignal[]} */
    const signals = []
    const agents = createTakeAgents({ store, engine: () => ({ models, model: faux.getModel(), reasoning: "off" }), onChange: () => {}, renderFor: () => async request => {
      if (request.signal) signals.push(request.signal)
      if (signals.length === 2) entered.resolve()
      await cleanup.promise
      request.signal?.throwIfAborted()
      return []
    } })
    await agents.start({ ...ask, prompt: "One" })
    await agents.start({ ...ask, prompt: "Two" })
    await entered.promise
    try {
      expect(signals).toHaveLength(2)
      let closed = false
      const closing = agents.close().then(() => { closed = true })
      expect(signals.every(signal => signal.aborted)).toBe(true)
      await Promise.resolve()
      expect(closed).toBe(false)
      cleanup.resolve()
      await closing
      expect((await agents.views()).every(view => view.run._tag !== "Running")).toBe(true)
      await expect(agents.start({ ...ask, prompt: "Too late" })).rejects.toThrow("closed")
    } finally { cleanup.resolve() }
  })
})
