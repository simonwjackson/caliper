// @ts-check
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createSourceRevision } from "../src/checks/source-revision.js"
import { createTakeStore } from "../src/takes/store.js"
import { manifest, withProject } from "./project-server.js"

/**
 * Workspaces slice 2: a scratch row is a part file in the workspace's folder.
 * Discovery never lists it (decision 18), but a frame, a check run and the
 * source revision treat it as the part it is.
 */

const ROW = ".caliper/workspaces/1/rows/1.part.tsx"
const workspace = {
  id: "1", created: 1, question: "Can the chip be reached by keyboard?", status: { _tag: "Open" },
  rows: [{ _tag: "Scratch", file: "rows/1.part.tsx", brief: "The chip, pressed by keyboard." }], questions: [],
}
const files = {
  "package.json": manifest("./src/index.ts"),
  "src/index.ts": "export {}\n",
  "src/Chip.tsx": "export const Chip = () => <button>real</button>\n",
  "src/Chip.part.tsx": 'import { Chip } from "./Chip"\nexport default function Part() { return <Chip /> }\n',
  ".caliper/takes/1.json": JSON.stringify({ subject: { _tag: "Idea", workspace: "1" }, device: "iphone-16", created: 2 }),
  ".caliper/takes/1/src/Chip.tsx": "export const Chip = () => <button>idea</button>\n",
  ".caliper/workspaces/1/workspace.json": JSON.stringify(workspace),
  [ROW]: [
    'import { Chip } from "../../../../src/Chip"',
    'export const name = "Chip by keyboard"',
    "export default function Row() { return <Chip /> }",
    "export const checks = {",
    "  default: {",
    '    "Enter presses the chip": async () => {},',
    "  },",
    "}",
    "",
  ].join("\n"),
}

/** @param {string} html */
function frameConfig(html) {
  const json = html.match(/<script type="application\/json" id="caliper-frame-config">(.*?)<\/script>/s)?.[1]
  if (json === undefined) throw new Error("The frame page has no config")
  return JSON.parse(json)
}

describe("a scratch row in the plugin", () => {
  test("the frame route serves a scratch row, tagged for an idea, and no other file of the workspace", async () => {
    await withProject({ files }, async ({ get }) => {
      const today = await get(`/__caliper/frame?part=${encodeURIComponent(ROW)}&state=default`)
      expect(today.status).toBe(200)
      expect(frameConfig(await today.text())).toMatchObject({ part: `/${ROW}`, partFile: ROW, state: "default" })
      const idea = await get(`/__caliper/frame?part=${encodeURIComponent(ROW)}&state=default&take=1`)
      expect(idea.status).toBe(200)
      expect(frameConfig(await idea.text())).toMatchObject({ part: `/${ROW}?take=1`, take: "1" })
      for (const part of [".caliper/workspaces/1/rows/2.part.tsx", ".caliper/workspaces/1/workspace.json", ".caliper/workspaces/2/rows/1.part.tsx"]) {
        expect((await get(`/__caliper/frame?part=${encodeURIComponent(part)}&state=default`)).status).toBe(404)
      }
      // A row has one state: its default export.
      expect((await get(`/__caliper/frame?part=${encodeURIComponent(ROW)}&state=Other`)).status).toBe(404)
      const project = await (await get("/__caliper/project.json")).json()
      expect(project.parts.map((/** @type {{ file: string }} */ part) => part.file)).toEqual(["src/Chip.part.tsx"])
    })
  })

  test("check-source lists a scratch row and its checks, in Today and in an idea", async () => {
    await withProject({ files }, async ({ get }) => {
      for (const query of ["", "?take=1"]) {
        const source = await (await get(`/__caliper/check-source${query}`)).json()
        const row = source.parts.find((/** @type {{ file: string }} */ part) => part.file === ROW)
        expect(row?.authoredChecks.default.map((/** @type {{ name: string }} */ check) => check.name)).toEqual(["Enter presses the chip"])
      }
    })
  })
})

test("an edit to a scratch row changes the source revision; the workspace record does not", () => {
  const root = mkdtempSync("/tmp/caliper-row-revision-")
  try {
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(join(root, file, ".."), { recursive: true })
      writeFileSync(join(root, file), content)
    }
    const revision = createSourceRevision({ root, store: createTakeStore(root) })
    const before = revision.revision({})
    writeFileSync(join(root, ROW), `${files[ROW]}// edited\n`)
    revision.invalidate(join(root, ROW))
    const after = revision.revision({})
    expect(after.generation).toBeGreaterThan(before.generation)
    expect(after.fingerprint).not.toBe(before.fingerprint)
    writeFileSync(join(root, ".caliper/workspaces/1/workspace.json"), JSON.stringify({ ...workspace, question: "Changed" }))
    revision.invalidate(join(root, ".caliper/workspaces/1/workspace.json"))
    expect(revision.revision({})).toEqual(after)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
