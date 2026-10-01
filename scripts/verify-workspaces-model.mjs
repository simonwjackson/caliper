#!/usr/bin/env -S nix develop -c node
// Real-model workspace run (decision 45). It spends model tokens: the planner
// runs once and three idea agents run once. It drives the chrome of a running
// Caliper app in Chromium, as a person would: New workspace, pin the rows,
// write the question, plan three ideas, wait for every idea, then read the
// board and the questions. It writes into the project's .caliper/ (a
// workspace and three takes), which Git ignores, and changes no project file.
//
// Usage: nix develop -c node scripts/verify-workspaces-model.mjs --root <project root>
//   [--app http://127.0.0.1:3132] [--rows <part>#<state>,...] [--question <text>]
//   [--ideas 3] [--minutes 20] [--out <dir>]
// The project's dev server and the app must already run; the app's settings name the model.
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright-core"

if (!process.env.CHROMIUM) throw new Error("Run with nix develop to supply CHROMIUM.")
const option = (/** @type {string} */ name, /** @type {string} */ fallback) => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] ?? fallback : fallback }
const app = option("--app", "http://127.0.0.1:3132").replace(/\/$/, "")
const root = option("--root", "")
if (!root) throw new Error("Name the project with --root <its folder>.")
const rows = option("--rows", "src/pages/PicoHome.page.part.tsx#default,src/pages/PicoLibrary.page.part.tsx#default,src/pages/PicoSettings.page.part.tsx#default")
  .split(",").map(item => { const [part = "", state = "default"] = item.split("#"); return { part, state } })
const question = option("--question", "A person can open Settings using only the d-pad, A and B. Today Settings opens only on the system input, which the host never sends. Find and mode cycling work on a gamepad, but no hint on screen names them. Does Find also get a focusable entry?")
const ideas = Number(option("--ideas", "3"))
const minutes = Number(option("--minutes", "20"))
const out = option("--out", "/tmp/caliper-workspaces-model")
mkdirSync(out, { recursive: true })
const log = (/** @type {string} */ step, /** @type {object} */ data = {}) => console.log(JSON.stringify({ step, at: new Date().toISOString(), ...data }))

const listed = await (await fetch(`${app}/__caliper/api/projects`)).json()
const project = listed.projects.find((/** @type {{ root: string }} */ item) => item.root === root)
if (!project || project.status !== "Ready") throw new Error(`The app lists no ready project at ${root}: ${JSON.stringify(listed.projects.map((/** @type {{ root: string, status: string }} */ item) => [item.root, item.status]))}`)
log("project", { name: project.name, chrome: project.chrome, protocol: listed.protocol })

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: "dark" })
/** @type {string[]} */
const errors = []
page.on("pageerror", error => errors.push(error.message))
/** @param {string} hook */
const cal = hook => `[data-cal="${hook}"]`
const shot = async (/** @type {string} */ name) => { await page.screenshot({ path: join(out, `${name}.png`) }); log("shot", { file: join(out, `${name}.png`) }) }
try {
  await page.goto(`${app}${project.chrome}`)
  await page.waitForSelector(cal("workspace-new"), { timeout: 60_000 })
  await page.locator(cal("workspace-new")).click()
  await page.waitForSelector(cal("board"))
  const workspace = await page.locator(`${cal("workspace")}[aria-current="true"]`).getAttribute("data-workspace")
  log("workspace", { workspace })

  for (const row of rows) {
    const expand = page.locator(`${cal("part-expand")}[data-part="${row.part}"]`)
    if (await expand.getAttribute("aria-expanded") !== "true") await expand.click()
    const pin = page.locator(`${cal("state-pin")}[data-part="${row.part}"][data-state="${row.state}"]`)
    await pin.click()
    await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute("aria-pressed") === "true", `${cal("state-pin")}[data-part="${row.part}"][data-state="${row.state}"]`)
  }
  log("pinned", { rows: await page.locator(".ws-row").count() })
  await page.locator(cal("prompt")).fill(question)
  await page.getByRole("button", { name: "More ways to start" }).click()
  await page.getByRole("menuitemradio", { name: ideas === 1 ? "1 idea" : `${ideas} ideas, planned` }).click()
  await shot("1-question")
  const started = Date.now()
  await page.locator(cal("workspace-start")).click()
  await page.waitForFunction(count => document.querySelectorAll('[data-cal="board-idea"]').length >= count, ideas, { timeout: 120_000 })
  log("planned", { seconds: (Date.now() - started) / 1000, title: await page.locator(".ws-board__title h1").textContent(), ideas: await page.locator(cal("board-idea")).allTextContents() })
  await shot("2-running")

  const deadline = Date.now() + minutes * 60_000
  for (;;) {
    const working = await page.locator(".ws-head__run").count() + await page.locator('.ws-cell[data-run="Running"]').count()
    if (working === 0) break
    if (Date.now() > deadline) throw new Error(`The ideas still work after ${minutes} minutes.`)
    await page.waitForTimeout(10_000)
  }
  log("ideas done", { seconds: (Date.now() - started) / 1000 })
  // Let every frame load and report, and the board compare the cells with Today.
  await page.waitForFunction(() => [...document.querySelectorAll(".ws-cell[data-verdict]")].every(cell => cell.getAttribute("data-verdict") !== "Loading"), undefined, { timeout: 120_000 }).catch(() => log("frames still loading"))
  await page.waitForTimeout(1500)
  const cells = await page.locator(".ws-cell").evaluateAll(nodes => nodes.map(node => ({
    cell: node.getAttribute("aria-label"), verdict: node.getAttribute("data-verdict"), same: node.hasAttribute("data-same"), run: node.getAttribute("data-run"),
  })))
  const snapshot = await (await fetch(`${app}${project.chrome}takes.json`)).json()
  const view = snapshot.workspaces.find((/** @type {{ id: string }} */ item) => item.id === workspace)
  log("board", {
    cells, same: cells.filter(cell => cell.same).length,
    ideas: view.ideas.map((/** @type {any} */ idea) => ({ take: idea.take, name: idea.name, run: idea.run, files: idea.files, said: idea.log.filter((/** @type {any} */ entry) => entry._tag === "Assistant").at(-1)?.text?.slice(0, 400), renders: idea.log.filter((/** @type {any} */ entry) => entry._tag === "Tool" && entry.name === "render").length })),
    questions: view.questions.map((/** @type {any} */ item) => ({ by: item.by, text: item.text })),
    partTakes: snapshot.takes.length,
  })
  await shot("3-board")
  await page.locator(cal("questions-open")).click()
  await page.waitForSelector(cal("questions"))
  await shot("4-questions")
  writeFileSync(join(out, "summary.json"), JSON.stringify({ workspace, cells, view }, null, 2))
  if (errors.length) log("page errors", { errors })
} finally {
  await browser.close()
}
