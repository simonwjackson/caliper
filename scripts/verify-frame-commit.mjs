#!/usr/bin/env -S nix shell nixpkgs#nodejs --command node
// Verify frame verdicts against actual React commits, not elapsed animation frames.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { createServer } from "vite"
import { chromium } from "playwright-core"
import { caliper } from "../src/plugin.js"
import { installRouting, projectBase, startApp } from "./caliper-app.mjs"
import { FRAME_WATCHDOG_MS } from "../src/pages.js"
import { cal, waitFrames } from "./verify-helpers.mjs"

const { values } = parseArgs({ options: { modules: { type: "string" } } })
assert(values.modules && process.env.CHROMIUM, "Pass --modules and set CHROMIUM")
const root = mkdtempSync(join(tmpdir(), "caliper-frame-commit-"))
/** @param {string} file @param {string} text */
const write = (file, text) => {
  const path = join(root, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}
write("package.json", JSON.stringify({ name: "frame-commit-consumer", type: "module", exports: { ".": "./src/index.ts" } }))
write("tsconfig.json", JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }))
write("src/index.ts", 'import "./global.css"')
write("src/global.css", "body { margin: 0; background: white; color: black; }")
write("src/Commit.part.tsx", `import { useEffect, useState } from "react"
let settled = false
const delayed = new Promise<void>(resolve => setTimeout(() => { settled = true; document.documentElement.dataset.fixtureSettled = "true"; resolve() }, 180))
const pending = new Promise<void>(() => {})
export default function Ready() { return <button>Ready</button> }
export function Delayed() { if (!settled) throw delayed; return <button>Committed after suspension</button> }
export function DelayedEmpty() { if (!settled) throw delayed; return null }
export function Pending() { throw pending }
export function Empty() { return null }
export function Throwing() { throw new Error("deliberate render failure") }
export function EffectError() { useEffect(() => { throw new Error("deliberate effect failure") }, []); return <button>Before effect</button> }
export function EffectContent() {
  const [ready, setReady] = useState(false)
  useEffect(() => { setReady(true) }, [])
  return ready ? <button>Effect content</button> : null
}
export function LaterContent() {
  const [ready, setReady] = useState(false)
  useEffect(() => { const timer = setTimeout(() => setReady(true), 180); return () => clearTimeout(timer) }, [])
  return ready ? <button>Later content</button> : null
}
export function BecomesEmpty() {
  const [ready, setReady] = useState(true)
  return ready ? <button onClick={() => setReady(false)}>Remove content</button> : null
}
`)
symlinkSync(resolve(values.modules), join(root, "node_modules"), "dir")
const server = await createServer({ root, cacheDir: join(root, ".vite"), configFile: false, logLevel: "silent", plugins: [caliper({ wrap: false })], server: { host: "127.0.0.1", port: 0 } })
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
/** @type {Awaited<ReturnType<typeof startApp>> | undefined} */
let app
try {
  await server.listen()
  app = await startApp()
  const url = await projectBase(app, root)
  assert(url)
  const failures = []
  for (const [state, expected, text] of [
    ["Delayed", "Rendered", "Committed after suspension"],
    ["DelayedEmpty", "Empty", ""],
    ["Empty", "Empty", ""],
    ["default", "Rendered", "Ready"],
    ["EffectContent", "Rendered", "Effect content"],
    ["LaterContent", "Rendered", "Later content"],
    ["BecomesEmpty", "Empty", "Remove content"],
    ["Throwing", "Failed", ""],
    ["EffectError", "Failed", ""],
    ["Pending", "Failed", ""],
  ]) {
    const context = await browser.newContext()
    const page = await context.newPage()
    try {
      await installRouting(page, /** @type {NonNullable<typeof app>} */ (app))
      await page.goto(`${url}__caliper/frame?part=src/Commit.part.tsx&state=${state}`)
      if (text) await page.getByRole("button", { name: text, exact: true }).waitFor()
      if (state === "LaterContent") await page.waitForFunction(() => document.documentElement.dataset.caliperState === "Rendered")
      if (state === "BecomesEmpty") {
        await page.getByRole("button", { name: text, exact: true }).click()
        await page.waitForFunction(() => document.documentElement.dataset.caliperState === "Empty")
      }
      await page.waitForFunction(() => ["Rendered", "Empty", "Failed"].includes(document.documentElement.dataset.caliperState ?? ""), undefined, { timeout: FRAME_WATCHDOG_MS + 5_000 })
      if (state === "EffectError") await page.locator("#caliper-problem").waitFor()
      const actual = await page.evaluate(() => ({
        state: document.documentElement.dataset.caliperState,
        warning: document.querySelector("#caliper-warning")?.textContent ?? "",
        failure: document.querySelector("#caliper-problem")?.textContent ?? "",
        settled: document.documentElement.dataset.fixtureSettled === "true",
      }))
      assert.equal(actual.state, expected, `${state}: ${JSON.stringify(actual)}`)
      if (state === "DelayedEmpty") assert(actual.settled, "a suspended null render must commit before it becomes Empty")
      if (expected === "Rendered") assert(!actual.warning.includes("rendered nothing"), `${state} retained an Empty warning over content`)
      if (expected === "Empty") assert(actual.warning.includes("rendered nothing"), `${state} must explain empty content`)
      if (state === "Pending") assert(actual.failure.includes("seconds"), "unresolved suspension must reach the watchdog, not Empty")
      console.log(`${state}: ${actual.state}`)
    } catch (error) {
      failures.push(error)
      console.error(String(error))
    } finally { await context.close() }
  }
  const parent = await browser.newPage()
  try {
    await parent.goto(`${url}__caliper/#part=src%2FCommit.part.tsx&state=Pending`)
    await waitFrames(parent, 1, "Failed")
    await parent.locator(cal.frameProblem).filter({ hasText: 'did not finish its first render' }).waitFor({ timeout: FRAME_WATCHDOG_MS + 5_000 })
    assert((await parent.locator(cal.frameProblem).allTextContents()).some(problem => problem.includes('did not finish its first render')), 'watchdog failures reach the parent chrome')
  } finally { await parent.close() }
  assert.equal(failures.length, 0, `${failures.length} frame verdict regressions`)
  console.log("Verified real React delayed commits, null renders, effect updates, errors, and unresolved suspension.")
} finally {
  await browser.close()
  if (server.httpServer && "closeAllConnections" in server.httpServer) server.httpServer.closeAllConnections()
  await app?.close(); await server.close()
  rmSync(root, { recursive: true, force: true })
}
