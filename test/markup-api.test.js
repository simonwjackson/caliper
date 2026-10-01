// @ts-check
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { createServer } from "node:http"
import { createMarkStore } from "../src/takes/marks.js"
import { createMarkupApi } from "../src/agent/markup.js"
import { createTakeAgents } from "../src/agent/take-agents.js"
import { validateTakeContext } from "../src/agent/api.js"
import { renderJobs } from "../src/render/render.js"
import { withViewport } from "../src/render/plan.js"
import { manifest, withProject } from "./project-server.js"
import { createTakeStore } from "../src/takes/store.js"
import { createIntegrationReview } from "../src/takes/integration.js"

const part = "src/Chip.part.tsx"
const files = {
  "package.json": manifest(),
  "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }),
  "src/index.ts": 'import "./chip.css"\n',
  "src/chip.css": ".chip { color: blue; padding: 8px }\n",
  "src/Chip.tsx": 'export function Chip() { return <div className="bar"><button className="chip">Chip default</button><span className="note">Note</span></div> }\n',
  [part]: 'import { Chip } from "./Chip"\nexport default function Part() { return <Chip /> }\n',
}
// A reachable configuration whose model endpoint refuses: agents start and fail fast.
const options = { agent: { model: "m", baseUrl: "http://127.0.0.1:9/v1", apiKeyEnv: "PATH", skills: /** @type {false} */ (false) } }
const preview = { part, state: "default" }

/** @param {string} selector @param {string} text @param {Partial<import("../src/takes/marks-contract.js").MarkAnchor>} [extra] */
const anchorOn = (selector, text, extra = {}) => ({
  kind: /** @type {const} */ ("Point"), rect: { x: 12, y: 12, width: 0, height: 0 }, elements: [], afterInput: false,
  element: { selector, tag: "button", classes: ["chip"], text, box: { x: 0, y: 0, width: 80, height: 30 } }, ...extra,
})

/** @param {string} url */
const client = url => {
  /** @param {string} path @param {unknown} body */
  const post = async (path, body) => {
    const response = await fetch(new URL(`__caliper/${path}`, url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    return { status: response.status, body: /** @type {any} */ (await response.json()) }
  }
  const draft = async () => /** @type {import("../src/takes/marks-contract.js").Draft} */ (await (await fetch(new URL("__caliper/marks.json", url))).json())
  return { post, draft }
}

/** @param {(path: string) => Promise<Response>} get @param {string} take */
async function settled(get, take) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    /** @type {import("../src/types").TakesSnapshot} */
    const snapshot = await (await get("/__caliper/takes.json")).json()
    const view = snapshot.takes.find(candidate => candidate.take === take)
    if (view && view.run._tag !== "Running" && view.log.length) return view
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`Take ${take} never settled`)
}

describe("the draft of marks on the dev server", () => {
  test("validates the marked take, refuses stale writes and keeps the draft on disk", () => withProject({ files, options }, async ({ url, root }) => {
    const store = createTakeStore(root)
    const take = store.create({ part, state: "default", device: "iphone-16", prompt: "Warm" })
    const created = /** @type {number} */ (store.record(take)?.created)
    const alternate = createIntegrationReview(store).begin(take)
    const { post, draft } = client(url)
    expect(await draft()).toEqual({ revision: 0, marks: [] })
    const mark = { revision: 0, source: { take, created }, preview, device: "iphone-16", anchor: anchorOn("#caliper-host .chip", "Chip default") }
    expect((await post("marks", { ...mark, source: { take, created: created + 1 } })).body.error).toContain("no longer the take you marked")
    expect((await post("marks", { ...mark, source: { take: alternate, created: store.record(alternate)?.created } })).body.error).toContain("alternate")
    expect((await post("marks", { ...mark, preview: { part, state: "Busy" } })).body.error).toContain("does not show")
    expect((await post("marks", { ...mark, anchor: { kind: "Point" } })).status).toBe(400)
    const refused = await fetch(new URL("__caliper/marks", url), { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(mark) })
    expect(refused.status).toBe(403)

    const added = await post("marks", mark)
    expect(added.status).toBe(201)
    expect(added.body.draft.marks[0]).toMatchObject({ id: added.body.id, letter: "A", note: "" })
    const stale = await post(`marks/${added.body.id}`, { revision: 0, note: "late" })
    expect(stale.status).toBe(409)
    expect(stale.body.draft.revision).toBe(1)
    const noted = await post(`marks/${added.body.id}`, { revision: 1, note: "love this" })
    expect(noted.body.draft.marks[0].note).toBe("love this")
    expect(JSON.parse(readFileSync(join(root, ".caliper/marks.json"), "utf8")).revision).toBe(2)
    const removed = await post(`marks/${added.body.id}/remove`, { revision: 2 })
    expect(removed.body.draft).toEqual({ revision: 3, marks: [] })
  }), 30_000)

  test("the event stream sends the draft to every chrome", () => withProject({ files, options }, async ({ url, root }) => {
    const store = createTakeStore(root)
    const take = store.create({ part, state: "default", device: "iphone-16" })
    const controller = new AbortController()
    const stream = await fetch(new URL("__caliper/events", url), { signal: controller.signal })
    const reader = /** @type {ReadableStreamDefaultReader<Uint8Array>} */ (stream.body?.getReader())
    let seen = ""
    const until = async (/** @type {string} */ needle) => {
      while (!seen.includes(needle)) seen += new TextDecoder().decode((await reader.read()).value)
    }
    await until("event: marks\ndata: {\"revision\":0")
    await client(url).post("marks", { revision: 0, source: { take, created: store.record(take)?.created }, preview, device: "iphone-16", anchor: anchorOn("#caliper-host .chip", "Chip default") })
    await until("event: marks\ndata: {\"revision\":1")
    controller.abort()
  }), 30_000)
})

describe("Send", () => {
  test("a draft change during async release removes every new take and starts no agent", () => withProject({ files, modules: resolve("node_modules") }, async ({ root, project, viteUrl }) => {
    const chromium = process.env.CHROMIUM
    if (!chromium) throw new Error("Run with nix develop to supply CHROMIUM")
    const store = createTakeStore(root)
    const marks = createMarkStore(root)
    const parents = ["Warm", "Cool"].map(prompt => store.create({ part, state: "default", device: "iphone-16", prompt }))
    let revision = 0
    let id = ""
    for (const parent of parents) {
      const source = { take: parent, created: /** @type {number} */ (store.record(parent)?.created) }
      const added = marks.add(revision, { source, preview, device: "iphone-16", anchor: anchorOn("#caliper-host .chip", "Chip default") })
      revision = marks.change(added.draft.revision, added.id, { note: "More space" }).revision
      id = added.id
    }
    const entered = Promise.withResolvers()
    const continueRelease = Promise.withResolvers()
    const agents = createTakeAgents({ store, engine: () => { throw new Error("No agent must start") }, renderFor: () => async () => [], onChange: () => {} })
    const api = createMarkupApi({
      store,
      marks: { ...marks, release: async (revision, ids) => { entered.resolve(undefined); await continueRelease.promise; return marks.release(revision, ids) } },
      agents, project, validateTake: validateTakeContext, onDraft: () => {}, agentProblem: () => null,
      render: async jobs => {
        const viewed = await project()
        return renderJobs({ url: viteUrl, jobs: jobs.map(job => withViewport(viewed, job)), out: join(root, ".caliper", "send-race"), executablePath: chromium })
      },
    })
    const server = createServer((request, response) => { void api.handle(request.url ?? "", request, response) })
    await new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(undefined)))
    const port = /** @type {import("node:net").AddressInfo} */ (server.address()).port
    try {
      const sent = fetch(`http://127.0.0.1:${port}/marks/send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision }) })
      await entered.promise
      expect(store.list()).toHaveLength(4)
      const children = store.list().filter(take => !parents.includes(take))
      for (const child of children) {
        await expect(agents.discard(child)).rejects.toThrow("being changed")
        await expect(agents.follow(child, "race")).rejects.toThrow("being changed")
      }
      const changed = marks.change(revision, id, { note: "Newer note" })
      continueRelease.resolve(undefined)
      const response = await sent
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ draft: changed })
      expect(store.list()).toEqual(parents)
      expect(marks.read()).toEqual(changed)
      expect((await agents.views()).every(view => view.log.length === 0)).toBe(true)
    } finally {
      continueRelease.resolve(undefined)
      await agents.close()
      server.closeAllConnections()
      await new Promise(resolve => server.close(() => resolve(undefined)))
    }
  }), 60_000)

  test("makes one new take per marked take, with its marks, picture and history, and empties the draft", () => withProject({ files, options, modules: resolve("node_modules") }, async ({ url, root, get }) => {
    if (!process.env.CHROMIUM) throw new Error("Run with nix develop to supply CHROMIUM")
    const store = createTakeStore(root)
    const [one, two, three] = ["Warm", "Cool", "Plain"].map(prompt => store.create({ part, state: "default", device: "iphone-16", prompt }))
    const identity = (/** @type {string} */ take) => ({ take, created: /** @type {number} */ (store.record(take)?.created) })
    store.write(/** @type {string} */ (one), "src/chip.css", ".chip { color: red; padding: 8px }\n")
    const { post, draft } = client(url)
    let revision = 0
    const add = async (/** @type {string} */ take, /** @type {string} */ note, /** @type {any} */ anchor) => {
      const added = await post("marks", { revision, source: identity(take), preview, device: "iphone-16", anchor })
      const noted = await post(`marks/${added.body.id}`, { revision: added.body.draft.revision, note })
      revision = noted.body.draft.revision
      return added.body.id
    }
    await add(/** @type {string} */ (one), "too heavy", anchorOn("#caliper-host .chip", "Chip default"))
    await add(/** @type {string} */ (two), "love this", anchorOn("#caliper-host .chip", "Chip default"))
    await add(/** @type {string} */ (two), "menu row", anchorOn("#caliper-host .menu", "Open menu", { afterInput: true, kind: "Region", rect: { x: 0, y: 40, width: 100, height: 30 } }))

    const lost = await add(/** @type {string} */ (three), "gone", anchorOn("#caliper-host .missing", ""))
    const blocked = await post("marks/send", { revision })
    expect(blocked.status).toBe(400)
    expect(blocked.body.error).toContain(`${three}A: its element is not in a fresh render`)
    expect(store.list()).toEqual([one, two, three])
    revision = (await post(`marks/${lost}/remove`, { revision })).body.draft.revision
    expect((await post("marks/send", { revision: revision - 1 })).status).toBe(409)

    const sent = await post("marks/send", { revision })
    expect(sent.status).toBe(201)
    expect(sent.body.draft.marks).toEqual([])
    expect(await draft()).toEqual(sent.body.draft)
    const [fromOne, fromTwo] = sent.body.takes
    expect(sent.body.takes).toHaveLength(2)

    const record = store.record(fromOne)
    expect(record).toMatchObject({ parent: identity(/** @type {string} */ (one)), chain: identity(/** @type {string} */ (one)), history: { prompt: "Warm", lineage: [identity(/** @type {string} */ (one))], passes: [] } })
    expect(record?.marks?.map(mark => mark.note)).toEqual(["too heavy"])
    expect(store.read(fromOne, "src/chip.css")).toContain("red")
    expect(store.record(fromTwo)?.marks?.map(mark => mark.letter)).toEqual(["A", "B"])

    const view = await settled(get, fromOne)
    expect(view.images).toHaveLength(1)
    const brief = view.log.find(entry => entry._tag === "User")
    expect(brief?._tag === "User" && brief.text).toContain(`## Marks on take ${one} (this pass)\n${one}A: too heavy`)
    expect(brief?._tag === "User" && brief.text).not.toContain("love this")
    const png = readFileSync(join(root, ".caliper/takes", `${fromOne}.images`, "1.png"))
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    const other = await settled(get, fromTwo)
    const otherBrief = other.log.find(entry => entry._tag === "User")
    expect(otherBrief?._tag === "User" && otherBrief.text).toContain(`Not found in this render, drawn where they were placed: ${two}B.`)
    expect(otherBrief?._tag === "User" && otherBrief.text).toContain("Placed after input")
    expect(existsSync(join(root, ".caliper/takes", String(three)))).toBe(true)
    expect(store.record(/** @type {string} */ (three))?.marks).toBeUndefined()
  }), 60_000)
})
