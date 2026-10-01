// @ts-check
import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createWorkspaceStore, rowParts } from "../src/takes/workspaces.js"

/** @param {(root: string) => void} run */
function inFolder(run) {
  const root = mkdtempSync(join(tmpdir(), "caliper-workspaces-"))
  try { run(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

const home = { _tag: /** @type {const} */ ("State"), part: "src/Home.page.part.tsx", state: "default" }
const find = { _tag: /** @type {const} */ ("State"), part: "src/Find.page.part.tsx", state: "NoResults" }

describe("the workspace store", () => {
  test("a new workspace is open, holds its question and nothing else, and keeps it on disk", () => inFolder(root => {
    const store = createWorkspaceStore(root)
    const first = store.create("Can Settings open with the d-pad?")
    const second = store.create("")
    expect(first).toMatchObject({ id: "1", question: "Can Settings open with the d-pad?", status: { _tag: "Open" }, rows: [], questions: [] })
    expect(second.id).toBe("2")
    expect(createWorkspaceStore(root).read("1")).toEqual(first)
    expect(store.list()).toEqual(["1", "2"])
    expect(store.read("9")).toBeNull()
  }))

  test("a pinned state is one row, in pin order; unpinning removes it", () => inFolder(root => {
    const store = createWorkspaceStore(root)
    const { id } = store.create("q")
    store.pin(id, home)
    store.pin(id, find)
    expect(store.pin(id, home).rows).toEqual([home, find])
    expect(store.unpin(id, home).rows).toEqual([find])
  }))

  test("a question is asked open, then answered with a reason", () => inFolder(root => {
    const store = createWorkspaceStore(root)
    const { id } = store.create("q")
    const asked = store.ask(id, "Does Find get an entry?", { _tag: "User" })
    expect(asked.questions).toEqual([{ _tag: "Open", id: "1", text: "Does Find get an entry?", by: { _tag: "User" }, asked: expect.any(Number) }])
    const fromIdea = store.ask(id, "Do places count as carts?", { _tag: "Idea", take: "3", created: 7, title: "Settings is a cart" })
    expect(fromIdea.questions.map(question => question.id)).toEqual(["1", "2"])
    const answered = store.answer(id, "1", "Yes, next to Settings.", "Rule 6.")
    expect(answered.questions[0]).toMatchObject({ _tag: "Answered", id: "1", text: "Does Find get an entry?", answer: "Yes, next to Settings.", reason: "Rule 6.", at: expect.any(Number) })
    expect(() => store.answer(id, "1", "Again", "Why")).toThrow("already answered")
    expect(() => store.answer(id, "9", "A", "R")).toThrow("no question 9")
    expect(() => store.ask(id, " ", { _tag: "User" })).toThrow("empty")
  }))

  test("closing keeps the question and the answers, and a closed workspace changes no more", () => inFolder(root => {
    const store = createWorkspaceStore(root)
    const { id } = store.create("q")
    store.pin(id, home)
    store.ask(id, "Why?", { _tag: "User" })
    const closed = store.close(id)
    expect(closed).toMatchObject({ question: "q", status: { _tag: "Closed", at: expect.any(Number), promoted: [] }, rows: [home] })
    expect(closed.questions).toHaveLength(1)
    expect(() => store.pin(id, find)).toThrow("closed")
    expect(() => store.ask(id, "More?", { _tag: "User" })).toThrow("closed")
    expect(() => store.setQuestion(id, "new")).toThrow("closed")
  }))

  test("a damaged workspace file is reported by name and does not hide the others", () => inFolder(root => {
    const store = createWorkspaceStore(root)
    store.create("good")
    mkdirSync(join(root, ".caliper/workspaces/2"), { recursive: true })
    writeFileSync(join(root, ".caliper/workspaces/2/workspace.json"), "{ not json")
    expect(store.overview()).toEqual([
      { _tag: "Read", workspace: expect.objectContaining({ id: "1", question: "good" }), scratch: [] },
      { _tag: "Damaged", id: "2", reason: expect.stringContaining(".caliper/workspaces/2/workspace.json") },
    ])
    expect(() => store.read("2")).toThrow(".caliper/workspaces/2/workspace.json")
  }))

  test("a scratch row gets its file name from Caliper, keeps its board place, and has no file until written (slice 2)", () => inFolder(root => {
    const store = createWorkspaceStore(root)
    const { id } = store.create("q")
    store.pin(id, home)
    const { row, workspace } = store.addScratch(id, "Home by d-pad. Check that A opens Settings.")
    expect(row).toEqual({ _tag: "Scratch", file: "rows/1.part.tsx", brief: "Home by d-pad. Check that A opens Settings." })
    expect(workspace.rows).toEqual([home, row])
    expect(store.readRow(id, row.file)).toBeNull()
    store.writeRow(id, row.file, "export default function Row() { return null }\n")
    expect(readFileSync(join(root, ".caliper/workspaces/1/rows/1.part.tsx"), "utf8")).toContain("function Row")
    expect(store.readRow(id, row.file)).toContain("function Row")
    expect(store.addScratch(id, "Another").row.file).toBe("rows/2.part.tsx")
    // Unpinning a state keeps the scratch rows.
    expect(store.unpin(id, home).rows.map(item => item._tag)).toEqual(["Scratch", "Scratch"])
  }))

  test("a row file is written only for a scratch row of an open workspace, and never through a link", () => inFolder(root => {
    const store = createWorkspaceStore(root)
    const { id } = store.create("q")
    const { row } = store.addScratch(id, "brief")
    for (const file of ["rows/9.part.tsx", "../workspace.json", "rows/../workspace.json", "workspace.json", "/etc/passwd"]) {
      expect(() => store.writeRow(id, file, "x")).toThrow()
    }
    expect(() => store.writeRow(id, row.file, "x".repeat(300_001))).toThrow("longer")
    expect(() => store.addScratch(id, " ")).toThrow("empty")
    const outside = mkdtempSync(join(tmpdir(), "caliper-outside-"))
    try {
      symlinkSync(outside, join(root, ".caliper/workspaces/1/rows"), "dir")
      expect(() => store.writeRow(id, row.file, "x")).toThrow("symbolic link")
      expect(existsSync(join(outside, "1.part.tsx"))).toBe(false)
    } finally { rmSync(outside, { recursive: true, force: true }); rmSync(join(root, ".caliper/workspaces/1/rows"), { force: true }) }
    store.close(id)
    expect(() => store.writeRow(id, row.file, "x")).toThrow("closed")
    expect(() => store.addScratch(id, "more")).toThrow("closed")
  }))

  test("removing a scratch row deletes its file and its place; closing keeps the rows and their files", () => inFolder(root => {
    const store = createWorkspaceStore(root)
    const { id } = store.create("q")
    const first = store.addScratch(id, "one").row
    const second = store.addScratch(id, "two").row
    store.writeRow(id, first.file, "export default function A() { return null }\n")
    store.writeRow(id, second.file, "export default function B() { return null }\n")
    expect(store.removeScratch(id, first.file).rows).toEqual([second])
    expect(existsSync(join(root, ".caliper/workspaces/1/rows/1.part.tsx"))).toBe(false)
    expect(() => store.removeScratch(id, first.file)).toThrow("no row")
    expect(store.close(id).rows).toEqual([second])
    expect(store.readRow(id, second.file)).toContain("function B")
  }))

  test("the overview says what each scratch row's file declares, and rowParts lists every written row as a part", () => inFolder(root => {
    const store = createWorkspaceStore(root)
    const { id } = store.create("q")
    const written = store.addScratch(id, "checked").row
    store.addScratch(id, "not yet")
    store.writeRow(id, written.file, [
      'export const name = "Home by d-pad"',
      "export default function Row() { return null }",
      "export const checks = {",
      "  default: {",
      '    "A opens Settings": async () => {},',
      '    "B returns": async () => {},',
      "  },",
      "}",
    ].join("\n"))
    const [entry] = store.overview()
    expect(entry?._tag === "Read" && entry.scratch).toEqual([
      { file: "rows/1.part.tsx", written: true, name: "Home by d-pad", checks: [{ name: "A opens Settings", line: 5 }, { name: "B returns", line: 6 }], problems: [] },
      { file: "rows/2.part.tsx", written: false, name: null, checks: [], problems: [] },
    ])
    const parts = rowParts(root)
    expect(parts.map(part => part.file)).toEqual([".caliper/workspaces/1/rows/1.part.tsx"])
    expect(parts[0]?.authoredChecks?.default?.map(check => check.name)).toEqual(["A opens Settings", "B returns"])
  }))

  test("a row agent reads source anywhere in the project's repository, but no secrets, packages or Git internals", () => {
    const repo = mkdtempSync(join(tmpdir(), "caliper-repo-"))
    try {
      const write = (/** @type {string} */ file, /** @type {string} */ text) => { mkdirSync(dirname(join(repo, file)), { recursive: true }); writeFileSync(join(repo, file), text) }
      write("surfaces/pico/src/Home.tsx", "home")
      write("clients/portal/src/input/bus.ts", "export function createInputBus() {}")
      write("clients/portal/.env", "SECRET=1")
      write("clients/portal/node_modules/x/index.js", "x")
      execFileSync("git", ["init", "-q"], { cwd: repo })
      const store = createWorkspaceStore(join(repo, "surfaces/pico"))
      expect(store.readSource("src/Home.tsx")).toBe("home")
      expect(store.readSource("../../clients/portal/src/input/bus.ts")).toContain("createInputBus")
      expect(store.listSource("../../clients/portal")).toEqual(["../../clients/portal/src/input/bus.ts"])
      // The repository's own root lists; it is not outside.
      expect(store.listSource("../..")).toEqual(["../../clients/portal/src/input/bus.ts", "src/Home.tsx"])
      for (const file of ["../../clients/portal/.env", "../../clients/portal/node_modules/x/index.js", "../../.git/config", "../../../outside.txt", "/etc/passwd"]) {
        expect(() => store.readSource(file)).toThrow()
      }
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  test("refuses a workspace folder that is a link out of the project", () => inFolder(root => {
    const outside = mkdtempSync(join(tmpdir(), "caliper-outside-"))
    try {
      mkdirSync(join(root, ".caliper"), { recursive: true })
      symlinkSync(outside, join(root, ".caliper/workspaces"), "dir")
      expect(() => createWorkspaceStore(root).create("q")).toThrow("symbolic link")
    } finally { rmSync(outside, { recursive: true, force: true }) }
  }))
})
