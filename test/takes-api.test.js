// @ts-check
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { manifest, withProject } from "./project-server.js"
import { createTakeStore } from "../src/takes/store.js"
import { createIntegrationReview } from "../src/takes/integration.js"

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
      expect(snapshot).toMatchObject({ agent: { _tag: "Off" }, skills: { skills: [], problems: [] }, takes: [] })
    })
  })

  test("lists the project's skills and the problems with agent.skills for the chrome", async () => {
    const skillFiles = {
      ...files,
      ".agents/skills/spacing/SKILL.md": "---\nname: spacing\ndescription: Spacing rules.\n---\nBody\n",
    }
    const options = { agent: { model: "m", baseUrl: "http://127.0.0.1:9/v1", apiKeyEnv: "PATH", skills: ["./missing"] } }
    await withProject({ files: skillFiles, options, git: true }, async ({ get }) => {
      /** @type {import("../src/types").TakesSnapshot} */
      const snapshot = await (await get("/__caliper/takes.json")).json()
      expect(snapshot.agent._tag).toBe("Ready")
      expect(snapshot.skills.skills).toContainEqual({ name: "spacing", description: "Spacing rules.", scope: "project", location: ".agents/skills/spacing/SKILL.md" })
      expect(snapshot.skills.problems).toContain("Skill folder missing does not exist.")
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

  test("serves take-only preview parts and states without adding them to the real project", async () => {
    await withProject({ files }, async ({ root, get, project }) => {
      const store = createTakeStore(root)
      const take = store.create({ part: "src/Chip.part.tsx", state: "default", device: "rg353m" })
      store.write(take, "src/Alternate.part.tsx", "export default () => <button>Alternate</button>\nexport const Quiet = () => <button>Quiet</button>")
      expect((await get(`/__caliper/frame?part=src/Alternate.part.tsx&state=Quiet&take=${take}`)).status).toBe(200)
      expect((await get(`/__caliper/frame?part=src/Alternate.part.tsx&state=Quiet`)).status).toBe(404)
      expect((await get(`/__caliper/frame?part=src/Alternate.part.tsx&state=Missing&take=${take}`)).status).toBe(404)
      expect((await project()).parts).toHaveLength(1)
      store.write(take, "src/New.ts", "export const value = 42")
      store.write(take, "src/New.part.tsx", 'import { value } from "./New"; export default function Part() { return value }')
      const module = await get(`/src/New.part.tsx?take=${take}`)
      expect(module.status).toBe(200)
      expect(await module.text()).toContain(`/src/New.ts?take=${take}`)
      expect((await get(`/src/New.ts?take=${take}`)).status).toBe(200)
      expect((await get("/src/New.ts")).status).toBe(404)
    })
  })

  test("requires review, checks, and explicit confirmation before applying an alternate", async () => {
    await withProject({ files }, async ({ root, url }) => {
      const store = createTakeStore(root)
      const integration = createIntegrationReview(store)
      const source = store.create({ part: "src/Chip.part.tsx", state: "default", device: "rg353m" })
      store.write(source, "src/app.css", ".chip { color: red }")
      const take = integration.begin(source)
      store.reset(take, "src/app.css")
      store.write(take, "src/Alternate.part.tsx", "export default () => <button>Alternate</button>")
      integration.submit(take, { strategy: "component", summary: "Separate alternate", shared: "Existing chip unchanged", preserved: "No existing files changed", usage: "Import Alternate", preview: { part: "src/Alternate.part.tsx", state: "default" } })
      const review = await (await post(url, `/__caliper/takes/${take}/review`, {})).json()
      expect(review.files[0].path).toBe("src/Alternate.part.tsx")
      expect((await post(url, `/__caliper/takes/${take}/accept`, {})).status).toBe(400)
      expect((await post(url, `/__caliper/takes/${take}/apply`, { revision: review.revision, behaviorReviewed: true })).status).toBe(400)
      expect((await post(url, `/__caliper/takes/${take}/apply`, { revision: review.revision })).status).toBe(400)
      expect(existsSync(join(root, "src/Alternate.part.tsx"))).toBe(false)
      expect(store.record(source)).not.toBeNull()
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

describe("declared preview scenarios", () => {
  const context = { part: "src/Home.part.tsx", state: "Ready" }
  const composedFiles = {
    ...files,
    "src/Home.part.tsx": 'export default function Part() { return null }\nexport function Ready() { return null }\nexport const composition = { Ready: [{ part: "src/Chip.part.tsx", state: "default" }] }\n',
  }
  const ask = { part: "src/Chip.part.tsx", state: "default", prompt: "Red", context }

  test("the API persists the editing subject separately from its composed preview", async () => {
    await withProject({ files: composedFiles }, async ({ url, get, root }) => {
      const created = await post(url, "/__caliper/takes", ask)
      expect(created.status).toBe(201)
      const { take } = await created.json()
      expect(await settledTake(get, take)).toMatchObject({ part: ask.part, state: ask.state, context })
      expect(JSON.parse(readFileSync(join(root, `.caliper/takes/${take}.json`), "utf8"))).toMatchObject({ part: ask.part, state: ask.state, context })
    })
  })

  test("create and plan reject malformed, missing and undeclared contexts before model work", async () => {
    await withProject({ files: composedFiles }, async ({ url }) => {
      for (const path of ["/__caliper/takes", "/__caliper/takes/plan"]) {
        for (const invalid of [null, "Ready", {}, { part: context.part }, { ...context, extra: true }, { part: "../secret", state: "default" }, { ...context, state: "default" }]) {
          const response = await post(url, path, { ...ask, context: invalid, count: 2 })
          expect(response.status).toBe(400)
          expect((await response.json()).error).not.toContain("agent is off")
        }
      }
    })
  })

  test("accept validates proposed part metadata before copying any files", async () => {
    await withProject({ files: composedFiles }, async ({ url, get, write, root }) => {
      const { take } = await (await post(url, "/__caliper/takes", ask)).json()
      await settledTake(get, take)
      write(`.caliper/takes/${take}/src/app.css`, ".chip { color: red }\n")
      write(`.caliper/takes/${take}/src/Home.part.tsx`, "export default function Part() { return null }\nexport function Ready() { return null }\n")
      const rejected = await post(url, `/__caliper/takes/${take}/accept`, {})
      expect(rejected.status).toBe(400)
      expect((await rejected.json()).error).toContain("not a declared context")
      expect(readFileSync(join(root, "src/app.css"), "utf8")).toContain("blue")
      expect(existsSync(join(root, `.caliper/takes/${take}.json`))).toBe(true)
      write(`.caliper/takes/${take}/src/Home.part.tsx`, composedFiles["src/Home.part.tsx"])
      expect((await post(url, `/__caliper/takes/${take}/accept`, {})).status).toBe(200)
      expect(readFileSync(join(root, "src/app.css"), "utf8")).toContain("red")
    })
  })

  test("accept tolerates unrelated existing errors but rejects newly introduced declaration errors", async () => {
    await withProject({ files: { ...composedFiles,
      "src/Unrelated.part.tsx": 'export default function Part() { return null }\nexport const composition = { default: [{ part: "src/Gone.part.tsx", state: "default" }] }',
    } }, async ({ url, get, write, root }) => {
      const { take } = await (await post(url, "/__caliper/takes", ask)).json()
      await settledTake(get, take)
      write(`.caliper/takes/${take}/src/app.css`, ".chip { color: red }\n")
      expect((await post(url, `/__caliper/takes/${take}/accept`, {})).status).toBe(200)
      expect(readFileSync(join(root, "src/app.css"), "utf8")).toContain("red")
      const second = await (await post(url, "/__caliper/takes", ask)).json()
      await settledTake(get, second.take)
      write(`.caliper/takes/${second.take}/src/New.part.tsx`, 'export default function Part() { return null }\nexport const composition = { default: [{ part: "src/Absent.part.tsx", state: "default" }] }')
      const rejected = await post(url, `/__caliper/takes/${second.take}/accept`, {})
      expect(rejected.status).toBe(400)
      expect((await rejected.json()).error).toContain("src/Absent.part.tsx")
      expect(existsSync(join(root, "src/New.part.tsx"))).toBe(false)
    })
  })

  test("a removed relationship blocks follow-up and accept but still permits discard", async () => {
    await withProject({ files: composedFiles }, async ({ url, get, write, project, root }) => {
      const { take } = await (await post(url, "/__caliper/takes", ask)).json()
      await settledTake(get, take)
      write(`.caliper/takes/${take}/src/app.css`, ".chip { color: red }\n")
      write("src/Home.part.tsx", "export default function Part() { return null }\nexport function Ready() { return null }\n")
      let refreshed = false
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (!(await project()).parts.find(part => part.file === context.part)?.composition) { refreshed = true; break }
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      expect(refreshed).toBe(true)
      for (const action of ["prompt", "accept"]) {
        const response = await post(url, `/__caliper/takes/${take}/${action}`, { prompt: "Again" })
        expect(response.status).toBe(400)
        expect((await response.json()).error).toContain("not a declared context")
      }
      expect(readFileSync(join(root, "src/app.css"), "utf8")).toContain("blue")
      expect(existsSync(join(root, `.caliper/takes/${take}/src/app.css`))).toBe(true)
      expect((await post(url, `/__caliper/takes/${take}/discard`, {})).status).toBe(200)
    })
  })
})

/** The smallest bytes each image type starts with; the server checks them. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 4, 5])

/** @param {string} name @param {string} mimeType @param {Buffer} bytes */
const image = (name, mimeType, bytes) => ({ name, mimeType, data: bytes.toString("base64") })

describe("images attached to a prompt", () => {
  test("a new take keeps its images beside the take, serves them, and discard removes them", async () => {
    await withProject({ files }, async ({ url, get, root }) => {
      const images = [image("mock.png", "image/png", PNG), image("photo.jpg", "image/jpeg", JPEG)]
      const created = await post(url, "/__caliper/takes", { part: "src/Chip.part.tsx", prompt: "Like this", images })
      expect(created.status).toBe(201)
      const { take } = await created.json()
      const view = await settledTake(get, take)
      expect(view.images).toEqual([
        { file: "1.png", name: "mock.png", mimeType: "image/png" },
        { file: "2.jpg", name: "photo.jpg", mimeType: "image/jpeg" },
      ])
      // Images are not edits: accept must never copy them into the project.
      expect(view.files).toEqual([])
      const served = await get(`/__caliper/takes/${take}/images/1.png`)
      expect(served.status).toBe(200)
      expect(served.headers.get("content-type")).toBe("image/png")
      expect(Buffer.from(await served.arrayBuffer())).toEqual(PNG)
      expect((await get(`/__caliper/takes/${take}/images/9.png`)).status).toBe(404)
      await post(url, `/__caliper/takes/${take}/discard`, {})
      expect(existsSync(join(root, ".caliper/takes", `${take}.images`))).toBe(false)
      expect((await get(`/__caliper/takes/${take}/images/1.png`)).status).toBe(404)
    })
  })

  test("names the problem with an image before any take starts", async () => {
    await withProject({ files }, async ({ url, get }) => {
      const ask = { part: "src/Chip.part.tsx", prompt: "Like this" }
      /** @param {unknown} images */
      const error = async images => (await (await post(url, "/__caliper/takes", { ...ask, images })).json()).error
      expect(await error([image("a.svg", "image/svg+xml", PNG)])).toBe('"a.svg" is not a PNG, JPEG, WebP or GIF image.')
      expect(await error([image("fake.png", "image/png", JPEG)])).toBe('"fake.png" is not a PNG image. Its bytes do not match its type.')
      expect(await error(Array.from({ length: 5 }, (_, index) => image(`${index}.png`, "image/png", PNG)))).toBe("A prompt can carry at most 4 images.")
      expect(await error([{ name: "a.png", mimeType: "image/png" }])).toBe("Each image needs a name, a type and base64 data.")
      expect(await error([image("big.png", "image/png", Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]))])).toBe('"big.png" is larger than 5 MB.')
      /** @type {import("../src/types").TakesSnapshot} */
      const snapshot = await (await get("/__caliper/takes.json")).json()
      expect(snapshot.takes).toEqual([])
    })
  })

  test("a follow-up prompt adds its images to the take", async () => {
    await withProject({ files }, async ({ url, get }) => {
      const { take } = await (await post(url, "/__caliper/takes", { part: "src/Chip.part.tsx", prompt: "Red" })).json()
      await settledTake(get, take)
      const followed = await post(url, `/__caliper/takes/${take}/prompt`, { prompt: "Like this", images: [image("ref.png", "image/png", PNG)] })
      expect(followed.status).toBe(200)
      const view = await settledTake(get, take)
      expect(view.images).toEqual([{ file: "1.png", name: "ref.png", mimeType: "image/png" }])
      expect(view.log.find(entry => entry._tag === "User" && entry.text === "Like this")).toEqual({ _tag: "User", text: "Like this", images: ["1.png"] })
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
