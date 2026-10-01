// @ts-check
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createWorkspaceStore } from "../src/takes/workspaces.js"

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
      { _tag: "Read", workspace: expect.objectContaining({ id: "1", question: "good" }) },
      { _tag: "Damaged", id: "2", reason: expect.stringContaining(".caliper/workspaces/2/workspace.json") },
    ])
    expect(() => store.read("2")).toThrow(".caliper/workspaces/2/workspace.json")
  }))

  test("refuses a workspace folder that is a link out of the project", () => inFolder(root => {
    const outside = mkdtempSync(join(tmpdir(), "caliper-outside-"))
    try {
      mkdirSync(join(root, ".caliper"), { recursive: true })
      symlinkSync(outside, join(root, ".caliper/workspaces"), "dir")
      expect(() => createWorkspaceStore(root).create("q")).toThrow("symbolic link")
    } finally { rmSync(outside, { recursive: true, force: true }) }
  }))
})
