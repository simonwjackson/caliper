#!/usr/bin/env -S nix develop -c node
// Real-model scratch row run (decision 45, workspaces slice 2). It spends model
// tokens: one row agent runs once. It drives the chrome of a running Caliper
// app in Chromium, as a person would: open a workspace that already has ideas,
// press New row, say what the row must show and check, press Write row, wait
// for the row agent, then for the row's checks in every column, and read the
// board and the row's record. It writes one row file into the project's
// .caliper/ (Git ignores it) and changes no project file.
//
// Usage: nix develop -c node scripts/verify-workspace-rows-model.mjs --root <project root> --workspace <id>
//   [--app http://127.0.0.1:3132] [--brief <text>] [--minutes 15] [--out <dir>]
// The project's dev server and the app must already run; the app's settings name the model.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright-core"

if (!process.env.CHROMIUM) throw new Error("Run with nix develop to supply CHROMIUM.")
const option = (/** @type {string} */ name, /** @type {string} */ fallback) => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] ?? fallback : fallback }
const app = option("--app", "http://127.0.0.1:3132").replace(/\/$/, "")
const root = option("--root", "")
const workspace = option("--workspace", "")
if (!root || !workspace) throw new Error("Name the project with --root <its folder> and the workspace with --workspace <id>.")
const brief = option("--brief", "Home as a person sees it on the device, on the portal's own input: its input bus, keyboard adapter and spatial focus in clients/portal/src/input, so the arrow keys are the d-pad, Enter is A and Escape is B. Check that the d-pad and A open Settings, and that B then returns to Home. Also check that the d-pad and A open Find.")
const minutes = Number(option("--minutes", "15"))
const out = option("--out", "/tmp/caliper-workspace-rows-model")
mkdirSync(out, { recursive: true })
const log = (/** @type {string} */ step, /** @type {object} */ data = {}) => console.log(JSON.stringify({ step, at: new Date().toISOString(), ...data }))

const listed = await (await fetch(`${app}/__caliper/api/projects`)).json()
const project = listed.projects.find((/** @type {{ root: string }} */ item) => item.root === root)
if (!project || project.status !== "Ready") throw new Error(`The app lists no ready project at ${root}: ${JSON.stringify(listed.projects.map((/** @type {{ root: string, status: string }} */ item) => [item.root, item.status]))}`)
log("project", { name: project.name, chrome: project.chrome, protocol: listed.protocol })
const snapshot = async () => (await fetch(`${app}${project.chrome}takes.json`)).json()
const viewOf = async () => (await snapshot()).workspaces.find((/** @type {{ id: string }} */ item) => item.id === workspace)

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: "dark" })
/** @type {string[]} */
const errors = []
page.on("pageerror", error => errors.push(error.message))
/** @param {string} hook */
const cal = hook => `[data-cal="${hook}"]`
const shot = async (/** @type {string} */ name) => { await page.screenshot({ path: join(out, `${name}.png`) }); log("shot", { file: join(out, `${name}.png`) }) }
try {
  await page.goto(`${app}${project.chrome}#workspace=${workspace}`)
  await page.waitForSelector(cal("board"), { timeout: 60_000 })
  const before = await viewOf()
  log("workspace", { name: before.name, rows: before.rows.length, ideas: before.ideas.map((/** @type {{ take: string }} */ idea) => idea.take) })

  await page.locator(`.ws-rows ${cal("row-new")}`).click()
  await page.locator(cal("prompt")).fill(brief)
  await shot("1-new-row")
  const started = Date.now()
  await page.locator(cal("row-write")).click()
  await page.waitForSelector(cal("row-record"), { timeout: 60_000 })
  const file = (await viewOf()).rows.filter((/** @type {{ _tag: string }} */ row) => row._tag === "Scratch").at(-1)?.file
  log("row started", { file })
  await shot("2-writing")

  const deadline = Date.now() + minutes * 60_000
  for (;;) {
    const view = await viewOf()
    const row = view.scratch.find((/** @type {{ file: string }} */ item) => item.file === file)
    if (row && row.run._tag !== "Running") { log("row done", { seconds: (Date.now() - started) / 1000, run: row.run, written: row.written, name: row.name, checks: row.checks, problems: row.problems }); break }
    if (Date.now() > deadline) throw new Error(`The row agent still works after ${minutes} minutes.`)
    await page.waitForTimeout(5000)
  }
  // Then every column's checks, which start when the agent stops.
  const checkedAt = Date.now()
  for (;;) {
    const view = await viewOf()
    const cells = view.checks.filter((/** @type {{ row: string }} */ cell) => cell.row.endsWith(file))
    const settled = cells.length === view.ideas.length + 1 && cells.every((/** @type {{ status: string }} */ cell) => cell.status === "Done" || cell.status === "Unknown")
    if (settled || (view.scratch.find((/** @type {{ file: string }} */ item) => item.file === file)?.checks.length ?? 0) === 0) break
    if (Date.now() > deadline) throw new Error("The row's checks did not finish.")
    await page.waitForTimeout(3000)
  }
  log("checks done", { seconds: (Date.now() - checkedAt) / 1000 })
  await page.waitForTimeout(1500)
  const lines = await page.locator(".ws-cell").evaluateAll(nodes => nodes.map(node => ({ cell: node.getAttribute("aria-label"), line: node.querySelector(".ws-check")?.textContent ?? null })).filter(cell => cell.line !== null))
  const view = await viewOf()
  const row = view.scratch.find((/** @type {{ file: string }} */ item) => item.file === file)
  log("board", {
    lines,
    checks: view.checks.filter((/** @type {{ row: string }} */ cell) => cell.row.endsWith(file)).map((/** @type {any} */ cell) => ({ column: cell.column, device: cell.device, status: cell.status, reason: cell.reason, results: cell.results.map((/** @type {any} */ result) => `${result.status} ${result.name}${result.detail ? `: ${result.detail}` : ""}`) })),
    said: row.log.filter((/** @type {any} */ entry) => entry._tag === "Assistant").at(-1)?.text,
    tools: row.log.filter((/** @type {any} */ entry) => entry._tag === "Tool").map((/** @type {any} */ entry) => `${entry.name} ${entry.subject} ${entry.outcome}`),
  })
  await page.locator(".ws-board__body").evaluate(node => { node.scrollTop = node.scrollHeight })
  await shot("3-board")
  await page.locator(`${cal("board-cell")}[data-column="today"] ${cal("cell-checks")}`).last().click()
  await page.waitForSelector(cal("row-record"))
  await shot("4-record")
  writeFileSync(join(out, "row.part.tsx"), readFileSync(join(root, ".caliper", "workspaces", workspace, file), "utf8"))
  writeFileSync(join(out, "summary.json"), JSON.stringify({ workspace, file, lines, view }, null, 2))
  if (errors.length) log("page errors", { errors })
} finally {
  await browser.close()
}
