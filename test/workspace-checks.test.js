// @ts-check
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkDetail, createWorkspaceChecks } from "../src/agent/workspace-checks.js"
import { createWorkspaceStore } from "../src/takes/workspaces.js"

/**
 * Workspaces slice 2: checks in cells. The column run is a real function
 * with scripted outcomes; the runner queues, orders and records them.
 */

/** @param {(root: string) => Promise<void>} run */
async function inFolder(run) {
  const root = mkdtempSync(join(tmpdir(), "caliper-board-checks-"))
  try { await run(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

const ROW = 'export default function Row() { return null }\nexport const checks = {\n  default: {\n    "A opens Settings": async () => {},\n    "B returns": async () => {},\n  },\n}\n'

/**
 * @param {string} root
 * @param {{ passes?: Record<string, boolean>, fails?: Set<string>, ideas?: Array<{ take: string, run: { _tag: "Idle" | "Running" } }> }} [behavior]
 *   `passes`: per column ("today" or a take), whether both checks pass. `fails`: columns whose run throws.
 */
function setup(root, { passes = { today: false, 5: true, 6: true }, fails = new Set(), ideas = [{ take: "5", run: { _tag: "Idle" } }, { take: "6", run: { _tag: "Idle" } }] } = {}) {
  const workspaces = createWorkspaceStore(root)
  const workspace = workspaces.create("Can Settings open with the d-pad?").id
  const { row } = workspaces.addScratch(workspace, "Home by d-pad.")
  workspaces.writeRow(workspace, row.file, ROW)
  const image = join(root, "end.png")
  writeFileSync(image, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  /** @type {Array<{ take: string | null, rows: string[], device: string }>} */
  const runs = []
  let generation = 0
  /** @type {Set<() => void>} */
  const waiting = new Set()
  const checks = createWorkspaceChecks({
    workspaces,
    ideas: async () => ideas.map(idea => ({ ...idea, workspace, device: "rg353m" })),
    run: async ({ take, rows, device }) => {
      runs.push({ take, rows: rows.map(ref => ref.part), device })
      const column = take ?? "today"
      if (fails.has(column)) throw new Error("Chromium's product page crashed.")
      const pass = passes[column] === true
      return {
        revision: { epoch: "e", generation },
        rows: rows.map(ref => ({ ref, failure: null, checks: [
          { name: "A opens Settings", source: { file: ref.part, line: 4 }, status: pass ? "Passed" : "Failed", reason: pass ? "Completed" : "CheckError", durationMs: 9, errors: [], image,
            detail: pass ? "The named check completed without an observed error." : "page.evaluate: AssertionError: No control named Settings is reachable.: expected null not to be null\n    at line 4" },
          { name: "B returns", source: { file: ref.part, line: 5 }, status: pass ? "Passed" : "NotRun", reason: pass ? "Completed" : "Interrupted", durationMs: 0, errors: [], detail: "" },
        ] })),
      }
    },
    stamp: async () => ({ epoch: "e", generation }),
    onChange: () => { for (const resolve of waiting) { waiting.delete(resolve); resolve() } },
  })
  const idle = async () => { while (checks.busy()) await new Promise(resolve => waiting.add(() => resolve(undefined))) }
  const path = `.caliper/workspaces/${workspace}/${row.file}`
  return { workspaces, workspace, row, path, checks, runs, idle, bump: () => { generation += 1 }, read: () => /** @type {import("../src/types").Workspace} */ (workspaces.read(workspace)) }
}

describe("checks in cells", () => {
  test("a finished row is checked in Today and in every idle idea, one column at a time, and each check's result is kept", async () => {
    await inFolder(async root => {
      const { workspace, row, path, checks, runs, idle, read } = setup(root, { ideas: [{ take: "5", run: { _tag: "Idle" } }, { take: "6", run: { _tag: "Idle" } }, { take: "7", run: { _tag: "Running" } }] })
      checks.rowDone(workspace, row.file, "rg353m")
      await idle()
      expect(runs).toEqual([{ take: null, rows: [path], device: "rg353m" }, { take: "5", rows: [path], device: "rg353m" }, { take: "6", rows: [path], device: "rg353m" }])
      const cells = await checks.cells(read())
      expect(cells.map(cell => `${cell.column}:${cell.status}:${cell.results.filter(result => result.status === "Passed").length}/${cell.results.length}`))
        .toEqual(["today:Done:0/2", "5:Done:2/2", "6:Done:2/2"])
      const today = cells.find(cell => cell.column === "today")
      expect(today).toMatchObject({ row: path, state: "default", device: "rg353m", stale: false })
      expect(today?.results[0]).toMatchObject({ name: "A opens Settings", line: 4, status: "Failed", detail: "No control named Settings is reachable." })
      const key = today?.results[0]?.image ?? ""
      expect(checks.image(key)).toBe(join(root, "end.png"))
      expect(checks.image("0".repeat(16))).toBeNull()
    })
  })

  test("a result goes out of date when its column's sources change", async () => {
    await inFolder(async root => {
      const { workspace, row, checks, idle, bump, read } = setup(root)
      checks.rowDone(workspace, row.file, "rg353m")
      await idle()
      bump()
      expect((await checks.cells(read())).every(cell => cell.stale)).toBe(true)
    })
  })

  test("a column whose run fails says why; Check again runs one row everywhere; an idea that stops is checked again", async () => {
    await inFolder(async root => {
      const { workspace, row, path, checks, runs, idle, read } = setup(root, { fails: new Set(["5"]) })
      checks.rowDone(workspace, row.file, "rg353m")
      await idle()
      expect((await checks.cells(read())).find(cell => cell.column === "5")).toMatchObject({ status: "Unknown", reason: "Chromium's product page crashed." })
      runs.length = 0
      checks.checkRow(workspace, { part: path, state: "default" }, "rg353m")
      await idle()
      expect(runs.map(run => run.take)).toEqual([null, "5", "6"])
      runs.length = 0
      checks.ideaDone("6")
      await idle()
      expect(runs).toEqual([{ take: "6", rows: [path], device: "rg353m" }])
    })
  })

  test("cells show only rows and ideas that still exist, and a row with no checks is never run", async () => {
    await inFolder(async root => {
      const { workspaces, workspace, row, checks, runs, idle, read } = setup(root)
      checks.rowDone(workspace, row.file, "rg353m")
      await idle()
      workspaces.removeScratch(workspace, row.file)
      expect(await checks.cells(read())).toEqual([])
      const plain = workspaces.addScratch(workspace, "No checks.").row
      workspaces.writeRow(workspace, plain.file, "export default function Row() { return null }\n")
      runs.length = 0
      checks.rowDone(workspace, plain.file, "rg353m")
      await idle()
      expect(runs).toEqual([])
    })
  })
})

test("a check's failure reads as its own message, without the driver's wrapping", () => {
  expect(checkDetail("page.evaluate: AssertionError: No control named Find is reachable.: expected null not to be null\n    at x")).toBe("No control named Find is reachable.")
  expect(checkDetail("Error: The check did not finish within 15000 ms.")).toBe("The check did not finish within 15000 ms.")
  expect(checkDetail("expected 2 to equal 3")).toBe("expected 2 to equal 3")
})
