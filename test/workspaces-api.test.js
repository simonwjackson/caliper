// @ts-check
import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { manifest, withProject } from "./project-server.js"
import { createTakeStore } from "../src/takes/store.js"

const files = {
  "package.json": manifest(),
  "src/index.ts": 'import "./app.css"\n',
  "src/app.css": ".chip { color: blue }\n",
  "src/Chip.part.tsx": "export default function Part() { return <span className=\"chip\">chip</span> }\nexport const Quiet = () => <span className=\"chip\">quiet</span>\n",
}
const chip = "src/Chip.part.tsx"

/** @param {string} url @param {string} path @param {unknown} body */
function post(url, path, body) {
  return fetch(new URL(path.replace(/^\//, ""), url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
}

/** @param {(path: string) => Promise<Response>} get @returns {Promise<import("../src/types").TakesSnapshot>} */
async function snapshot(get) {
  return (await get("/__caliper/takes.json")).json()
}

describe("the workspaces API", () => {
  test("a workspace keeps its question, its pinned states and its answered questions", async () => {
    await withProject({ files }, async ({ url, get }) => {
      expect((await snapshot(get)).workspaces).toEqual([])
      const made = await post(url, "/__caliper/workspaces", { question: "" })
      expect(made.status).toBe(201)
      const { workspace } = await made.json()
      expect(workspace).toBe("1")
      const base = `/__caliper/workspaces/${workspace}`
      expect((await post(url, `${base}/question`, { question: "Can the chip read warmer?" })).status).toBe(200)
      expect((await post(url, `${base}/rows`, { part: chip, state: "default", pinned: true })).status).toBe(200)
      expect((await post(url, `${base}/rows`, { part: chip, state: "Quiet", pinned: true })).status).toBe(200)
      expect((await post(url, `${base}/rows`, { part: chip, state: "default", pinned: false })).status).toBe(200)
      const missing = await post(url, `${base}/rows`, { part: chip, state: "Loud", pinned: true })
      expect(missing.status).toBe(400)
      expect((await missing.json()).error).toContain('has no state "Loud"')
      const asked = await post(url, `${base}/questions`, { text: "Should it stay blue?" })
      expect(asked.status).toBe(201)
      expect(await asked.json()).toEqual({ question: "1" })
      expect((await post(url, `${base}/questions/1/answer`, { answer: "No.", reason: "Warm reads better at arm's length." })).status).toBe(200)
      const [view] = (await snapshot(get)).workspaces
      expect(view).toMatchObject({
        _tag: "Ready", id: "1", question: "Can the chip read warmer?", status: { _tag: "Open" },
        rows: [{ _tag: "State", part: chip, state: "Quiet" }],
        questions: [{ _tag: "Answered", id: "1", text: "Should it stay blue?", by: { _tag: "User" }, answer: "No.", reason: "Warm reads better at arm's length." }],
        ideas: [],
      })
      const unknown = await post(url, "/__caliper/workspaces/9/rows", { part: chip, state: "default", pinned: true })
      expect(unknown.status).toBe(404)
    })
  })

  test("a plan and a new idea need the question and a row, and a running agent", async () => {
    await withProject({ files }, async ({ url, root }) => {
      const { workspace } = await (await post(url, "/__caliper/workspaces", { question: "" })).json()
      const base = `/__caliper/workspaces/${workspace}`
      const device = "iphone-16"
      const noQuestion = await post(url, `${base}/plan`, { count: 3, device })
      expect(noQuestion.status).toBe(400)
      expect((await noQuestion.json()).error).toContain("Write the question first")
      await post(url, `${base}/question`, { question: "Can the chip read warmer?" })
      const noRows = await post(url, `${base}/ideas`, { device, prompt: "Try red" })
      expect((await noRows.json()).error).toContain("Pin a state first")
      await post(url, `${base}/rows`, { part: chip, state: "default", pinned: true })
      expect((await (await post(url, `${base}/plan`, { count: 9, device })).json()).error).toContain("2 to 4 ideas")
      expect((await (await post(url, `${base}/plan`, { count: 3, device: "toaster" })).json()).error).toContain("toaster")
      const off = await post(url, `${base}/plan`, { count: 3, device })
      expect(off.status).toBe(400)
      expect((await off.json()).error).toContain("The agent is off")
      // Without an agent an idea is made, and its run fails with the reason.
      const started = await post(url, `${base}/ideas`, { device, prompt: "Try red" })
      expect(started.status).toBe(201)
      const { take } = await started.json()
      expect(createTakeStore(root).record(take)).toMatchObject({ subject: { _tag: "Idea", workspace }, device, prompt: "Try red" })
      const elsewhere = await post(url, `/__caliper/workspaces/${workspace}/ideas/99/prompt`, { prompt: "More" })
      expect(elsewhere.status).toBe(404)
    })
  })

  test("an idea shows only on its workspace; discard deletes it and keeps the questions; a take of a part stays", async () => {
    await withProject({ files }, async ({ root, url, get }) => {
      const { workspace } = await (await post(url, "/__caliper/workspaces", { question: "Can the chip read warmer?" })).json()
      await post(url, `/__caliper/workspaces/${workspace}/questions`, { text: "Should it stay blue?" })
      // The planner makes ideas in the next step; here they are written as the store keeps them.
      const takes = createTakeStore(root)
      const idea = takes.create({ subject: { _tag: "Idea", workspace }, device: "iphone-16", direction: { title: "Warm red", brief: "Make the chip red." } })
      takes.write(idea, "src/app.css", ".chip { color: red }\n")
      // A record written before workspaces existed still loads as a take of its part.
      const legacy = takes.create({ part: chip, state: "default", device: "iphone-16", prompt: "Green" })
      const before = await snapshot(get)
      expect(before.takes.map(take => take.take)).toEqual([legacy])
      expect(before.workspaces[0]).toMatchObject({ _tag: "Ready", ideas: [{ take: idea, device: "iphone-16", direction: { title: "Warm red" }, files: ["src/app.css"], run: { _tag: "Idle" } }] })

      const accept = await post(url, `/__caliper/takes/${idea}/accept`, {})
      expect(accept.status).toBe(409)
      expect((await accept.json()).error).toContain(`is an idea of workspace ${workspace}`)
      expect(existsSync(join(root, ".caliper/takes", idea))).toBe(true)

      expect((await post(url, `/__caliper/workspaces/${workspace}/discard`, {})).status).toBe(200)
      const after = await snapshot(get)
      expect(after.takes.map(take => take.take)).toEqual([legacy])
      expect(after.workspaces[0]).toMatchObject({ _tag: "Ready", question: "Can the chip read warmer?", status: { _tag: "Closed", promoted: [] }, ideas: [], questions: [{ _tag: "Open", text: "Should it stay blue?" }] })
      expect(takes.record(idea)).toBeNull()
      const closed = await post(url, `/__caliper/workspaces/${workspace}/rows`, { part: chip, state: "default", pinned: true })
      expect(closed.status).toBe(400)
      expect((await closed.json()).error).toContain("is closed")
    })
  })
})
