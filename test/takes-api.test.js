// @ts-check
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { manifest, withProject } from "./project-server.js"

const files = {
  "package.json": manifest(),
  "src/index.ts": 'import "./app.css"\n',
  "src/app.css": ".chip { color: blue }\n",
  "src/Chip.part.tsx": "export default function Part() { return <span className=\"chip\">chip</span> }\n",
}

/**
 * @param {string} url
 * @param {string} path
 * @param {unknown} body
 * @param {Record<string, string>} [headers]
 */
function post(url, path, body, headers = {}) {
  return fetch(new URL(path.replace(/^\//, ""), url), {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

/**
 * @param {(path: string) => Promise<Response>} get
 * @param {string} take
 */
async function settledTake(get, take) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    /** @type {import("../src/types").TakesSnapshot} */
    const snapshot = await (await get("/__caliper/takes.json")).json()
    const view = snapshot.takes.find(candidate => candidate.take === take)
    if (view && view.run._tag !== "Running") return view
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`Take ${take} never settled`)
}

describe("the takes API", () => {
  test("reports the agent as off when vite.config has no agent", async () => {
    await withProject({ files }, async ({ get }) => {
      const snapshot = await (await get("/__caliper/takes.json")).json()
      expect(snapshot).toMatchObject({ agent: { _tag: "Off" }, takes: [] })
    })
  })

  test("refuses writes that are not JSON, or that come from another site", async () => {
    await withProject({ files }, async ({ url }) => {
      const ask = { part: "src/Chip.part.tsx", prompt: "Red" }
      const form = await fetch(new URL("__caliper/takes", url), { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(ask) })
      expect(form.status).toBe(403)
      expect((await post(url, "/__caliper/takes", ask, { origin: "https://evil.example" })).status).toBe(403)
    })
  })

  test("names the problem in a bad request", async () => {
    await withProject({ files }, async ({ url }) => {
      const unknown = await post(url, "/__caliper/takes", { part: "src/Nope.part.tsx", prompt: "Red" })
      expect(unknown.status).toBe(400)
      expect((await unknown.json()).error).toContain('"src/Nope.part.tsx" is not a part')
      expect((await (await post(url, "/__caliper/takes", { part: "src/Chip.part.tsx", prompt: " " })).json()).error).toBe("The prompt is empty.")
      expect((await post(url, "/__caliper/takes/7/accept", {})).status).toBe(404)
    })
  })

  test("a take started without an agent fails visibly, and discard removes it", async () => {
    await withProject({ files }, async ({ url, get, root }) => {
      const created = await post(url, "/__caliper/takes", { part: "src/Chip.part.tsx", prompt: "Red", device: "rg353m" })
      expect(created.status).toBe(201)
      const { take } = await created.json()
      const view = await settledTake(get, take)
      expect(view).toMatchObject({ part: "src/Chip.part.tsx", state: "default", device: "rg353m", files: [] })
      expect(view.run._tag === "Failed" && view.run.reason).toContain("The agent is off")
      expect(existsSync(join(root, ".caliper/takes", take))).toBe(true)
      expect((await post(url, `/__caliper/takes/${take}/discard`, {})).status).toBe(200)
      expect(existsSync(join(root, ".caliper/takes", take))).toBe(false)
    })
  })

  test("accept copies a take's files into the project", async () => {
    await withProject({ files }, async ({ url, get, root, write }) => {
      const { take } = await (await post(url, "/__caliper/takes", { part: "src/Chip.part.tsx", prompt: "Red" })).json()
      await settledTake(get, take)
      write(`.caliper/takes/${take}/src/app.css`, ".chip { color: red }\n")
      const accepted = await post(url, `/__caliper/takes/${take}/accept`, {})
      expect(await accepted.json()).toEqual({ take, files: ["src/app.css"] })
      expect(readFileSync(join(root, "src/app.css"), "utf8")).toContain("red")
    })
  })

  test("the event stream sends the takes with the project", async () => {
    await withProject({ files }, async ({ get }) => {
      const response = await get("/__caliper/events")
      const reader = /** @type {ReadableStreamDefaultReader<Uint8Array>} */ (response.body?.getReader())
      let text = ""
      while (!text.includes("event: takes")) text += new TextDecoder().decode((await reader.read()).value)
      await reader.cancel()
      expect(text).toContain("event: project")
      expect(text).toContain('"agent":{"_tag":"Off"')
    })
  })
})

describe("the plan endpoint", () => {
  test("names the problem when the agent is off, or the count is wrong", async () => {
    await withProject({ files }, async ({ url }) => {
      const off = await post(url, "/__caliper/takes/plan", { part: "src/Chip.part.tsx", prompt: "Red", count: 3 })
      expect(off.status).toBe(400)
      expect((await off.json()).error).toContain("The agent is off")
      const one = await post(url, "/__caliper/takes/plan", { part: "src/Chip.part.tsx", prompt: "Red", count: 1 })
      expect((await one.json()).error).toBe("Ask the planner for 2 to 4 directions.")
    })
  })

  test("a take started with a direction shows it", async () => {
    await withProject({ files }, async ({ url, get }) => {
      const direction = { title: "Warmer", brief: "Use the warm palette." }
      const { take } = await (await post(url, "/__caliper/takes", { part: "src/Chip.part.tsx", prompt: "Red", direction, others: ["Cooler"] })).json()
      expect((await settledTake(get, take)).direction).toEqual(direction)
      const bad = await post(url, "/__caliper/takes", { part: "src/Chip.part.tsx", prompt: "Red", direction: { title: "No brief" } })
      expect((await bad.json()).error).toBe("A direction needs a title and a brief.")
    })
  })
})
