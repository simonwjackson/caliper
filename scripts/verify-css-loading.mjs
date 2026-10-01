#!/usr/bin/env -S nix shell nixpkgs#nodejs --command node
/**
 * Exercise CSS loading with real React, Vite and Chromium, in a temporary
 * project. No product source is changed. Pass a React project's node_modules:
 * CHROMIUM=/path/to/chromium node scripts/verify-css-loading.mjs --modules /path/to/node_modules
 */
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { createServer } from "vite"
import { chromium } from "playwright-core"
import { caliper } from "../src/plugin.js"
import { projectBase, startApp } from "./caliper-app.mjs"
import { createTakeStore } from "../src/takes/store.js"
import { cal, reveal } from "./verify-helpers.mjs"

const { values } = parseArgs({ options: { modules: { type: "string" } } })
assert(values.modules && process.env.CHROMIUM, "Pass --modules and set CHROMIUM")
const root = mkdtempSync(join(tmpdir(), "caliper-css-browser-"))
/** @param {string} file @param {string} code */
const write = (file, code) => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), code)
}
const files = {
  "package.json": JSON.stringify({ name: "css-consumer", type: "module", exports: { ".": "./src/index.ts" } }),
  "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }),
  "src/index.ts": 'import "./tokens.css"\nimport "./global.css"\nexport { App } from "./App"',
  "src/tokens.css": '.theme { --ink: rgb(1, 2, 3); }',
  "src/global.css": '.theme { color: var(--ink); }',
  "src/App.tsx": 'import "./missing.css"; export { Button } from "./Button"; export { Badge } from "./Badge"; export const App = () => <main />',
  "src/Button.tsx": 'import "./motion.css"; import "./button.css"; export const Button = () => <button className="button">Button</button>',
  "src/button.css": '.button { color: inherit; letter-spacing: 1px; } .button:focus { animation: pulse 1s infinite; }',
  "src/motion.css": '@keyframes pulse { to { opacity: 0.5; } }',
  "src/Badge.tsx": 'import "./badge.css"; export const Badge = () => <span className="badge">Badge</span>',
  "src/badge.css": '.badge { font-weight: 700; }',
  "src/Missing.tsx": 'export const Missing = () => <span className="missing">Missing own import</span>',
  "src/missing.css": '.missing { color: rgb(255, 0, 0); }',
  "src/Module.tsx": 'import styles from "./local.module.css"; export const Module = () => <span className={styles.local}>Module</span>',
  "src/local.module.css": '.local { color: rgb(4, 5, 6); }',
  "src/Button.part.tsx": 'import { Button } from "./Button"; export default function Part() { return <Button /> }',
  "src/Badge.part.tsx": 'import { Badge } from "./Badge"; export default function Part() { return <Badge /> }',
  "src/Missing.part.tsx": 'import { Missing } from "./Missing"; export default function Part() { return <Missing /> }',
  "src/Module.part.tsx": 'import { Module } from "./Module"; export default function Part() { return <Module /> }',
  "src/Composition.part.tsx": 'import { Button } from "./Button"; import { Badge } from "./Badge"; export default function Part() { return <><Button /><Button /><Badge /></> }',
  "src/legacy.css": '@import "./legacy-child.css"; .theme { font-weight: 600; }',
  "src/legacy-child.css": '.theme { color: rgb(11, 12, 13); }',
}
for (const [file, code] of Object.entries(files)) write(file, code)
symlinkSync(resolve(values.modules), join(root, "node_modules"), "dir")
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
/** @type {import("vite").ViteDevServer | undefined} */
let server
/** @param {import("../src/types").CaliperOptions} options */
async function serve(options = {}) {
  const running = await createServer({ root, cacheDir: join(root, ".vite"), configFile: false, logLevel: "silent", plugins: [caliper({ wrap: "theme", ...options })], server: { host: "127.0.0.1", port: 0 } })
  await running.listen()
  return running
}
/** @param {import("vite").ViteDevServer} running */
function origin(running) {
  const url = running.resolvedUrls?.local[0]
  assert(url, "the server has a local URL")
  return url
}
/** @param {string} url @param {string} part @param {string} [take] @param {string} state */
async function frame(url, part, take = undefined, state = "Rendered") {
  const page = await browser.newPage()
  await page.goto(`${url}__caliper/frame?part=src/${part}.part.tsx${take ? `&take=${take}` : ""}`)
  await page.waitForFunction(() => ["Rendered", "Failed", "Empty"].includes(document.documentElement.dataset.caliperState ?? ""))
  const actual = await page.evaluate(() => document.documentElement.dataset.caliperState)
  assert.equal(actual, state, await page.locator("body").innerText())
  await page.evaluate(() => { document.documentElement.dataset.cssCheck = "same document" })
  return page
}
/** @param {import("playwright-core").Page} page */
async function sheets(page) {
  return (await page.locator("style[data-vite-dev-id]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-vite-dev-id") ?? "")))
    .map(file => basename(file.split("?")[0] ?? "")).sort()
}
/** @param {import("playwright-core").Page} page @param {string} selector @param {string} property */
async function value(page, selector, property) {
  return page.locator(selector).first().evaluate((node, property) => getComputedStyle(node).getPropertyValue(property), property)
}
/** @param {import("playwright-core").Page} page @param {string} file @param {boolean} present */
async function waitInjection(page, file, present) {
  await page.waitForFunction(async ({ file, present }) => {
    /** @type {import("../src/types").Project} */
    const project = await (await fetch("/__caliper/project.json")).json()
    return project.css._tag !== "Failed" && project.css.value.stylesheets.some(sheet => sheet.file === file) === present
  }, { file, present })
}
const store = createTakeStore(root)
/** @type {Awaited<ReturnType<typeof startApp>> | undefined} */
let app
try {
  server = await serve()
  let url = origin(server)
  /** @type {import("../src/types").Project} */
  const project = await (await fetch(`${url}__caliper/project.json`)).json()
  assert(project.css._tag !== "Failed")
  assert.deepEqual(project.css.value.stylesheets.map(sheet => sheet.file), ["src/tokens.css", "src/global.css"])
  const button = await frame(url, "Button")
  const badge = await frame(url, "Badge")
  const composition = await frame(url, "Composition")
  const missing = await frame(url, "Missing")
  const module = await frame(url, "Module")
  assert.deepEqual(await sheets(button), ["button.css", "global.css", "motion.css", "tokens.css"])
  assert.deepEqual(await sheets(badge), ["badge.css", "global.css", "tokens.css"])
  assert.deepEqual(await sheets(composition), ["badge.css", "button.css", "global.css", "motion.css", "tokens.css"])
  assert.equal(await value(missing, ".missing", "color"), "rgb(1, 2, 3)", "another component must not rescue a missing CSS import")
  assert.equal(await value(module, "span", "color"), "rgb(4, 5, 6)")
  await button.locator("button").focus()
  assert.equal(await value(button, "button", "animation-name"), "pulse")

  write("src/button.css", files["src/button.css"].replace("1px", "2px"))
  await button.waitForFunction(() => {
    const node = document.querySelector("button")
    return node && getComputedStyle(node).letterSpacing === "2px"
  })
  assert.equal(await button.evaluate(() => document.documentElement.dataset.cssCheck), "same document")
  assert.equal(await badge.evaluate(() => document.documentElement.dataset.cssCheck), "same document")
  assert.deepEqual(await sheets(badge), ["badge.css", "global.css", "tokens.css"])

  const take = store.create({ part: "src/Button.part.tsx", state: "default", device: "iphone-16" })
  store.write(take, "src/button.css", '.button { letter-spacing: 7px; color: inherit; }')
  const taken = await frame(url, "Button", take)
  assert.equal(await value(taken, "button", "letter-spacing"), "7px")
  store.write(take, "src/button.css", '.button { letter-spacing: 9px; color: inherit; }')
  await taken.waitForFunction(() => {
    const node = document.querySelector("button")
    return node && getComputedStyle(node).letterSpacing === "9px"
  })
  assert.equal(await taken.evaluate(() => document.documentElement.dataset.cssCheck), "same document")
  assert.equal(await value(button, "button", "letter-spacing"), "2px")
  store.write(take, "src/tokens.css", '.theme { --ink: rgb(7, 8, 9); }')
  const themed = await frame(url, "Button", take)
  assert.equal(await value(themed, "button", "color"), "rgb(7, 8, 9)")
  assert.equal(await value(button, "button", "color"), "rgb(1, 2, 3)")

  // A cached, flattened stylesheet must be rechecked if its entry import goes
  // away. Otherwise Vite can reuse the stripped CSS while no frame loads its children.
  const cachedTake = store.create({ part: "src/Button.part.tsx", state: "default", device: "iphone-16" })
  store.write(cachedTake, "src/button.css", '@import "./legacy-child.css"; .button { color: inherit; }')
  write("src/index.ts", `${files["src/index.ts"]}\nimport "./button.css"`)
  await waitInjection(button, "src/button.css", true)
  const wasGlobal = await frame(url, "Button", cachedTake)
  assert.equal(await value(wasGlobal, "button", "color"), "rgb(11, 12, 13)")
  write("src/index.ts", files["src/index.ts"])
  await waitInjection(button, "src/button.css", false)
  const noLongerGlobal = await frame(url, "Button", cachedTake, "Failed")
  assert.match(await noLongerGlobal.locator("#caliper-problem").textContent() ?? "", /did not load/)

  const badTake = store.create({ part: "src/Button.part.tsx", state: "default", device: "iphone-16" })
  store.write(badTake, "src/button.css", '@import "./legacy-child.css";')
  const failed = await frame(url, "Button", badTake, "Failed")
  assert.match(await failed.locator("#caliper-problem").textContent() ?? "", /did not load/)
  const cssError = await fetch(`${url}src/button.css?take=${badTake}`)
  assert.equal(cssError.status, 500)
  assert.match(await cssError.text(), /Import these stylesheets from JS or TS/)
  write("src/Missing.tsx", 'import "./does-not-exist.css"; export const Missing = () => <span />')
  const broken = await frame(url, "Missing", undefined, "Failed")
  assert.match(await broken.locator("#caliper-problem").textContent() ?? "", /did not load/)
  assert.match(await (await fetch(`${url}src/Missing.tsx`)).text(), /does-not-exist.css/)
  console.log("PASS: exact dependency sets, shared motion once, CSS modules, missing imports, CSS HMR, take isolation and unsupported-chain failure")
  await Promise.all(browser.contexts().map(context => context.close()))
  await server.close()
  write("src/Missing.tsx", files["src/Missing.tsx"])

  server = await serve({ css: ["src/legacy.css"] })
  url = origin(server)
  const overridden = await frame(url, "Badge")
  assert.equal(await value(overridden, ".badge", "color"), "rgb(11, 12, 13)")
  assert.deepEqual(await sheets(overridden), ["badge.css", "legacy.css"])
  store.write(take, "src/legacy-child.css", '.theme { color: rgb(21, 22, 23); }')
  const legacyTake = await frame(url, "Badge", take)
  assert.equal(await value(legacyTake, ".badge", "color"), "rgb(21, 22, 23)")
  assert.equal(await value(overridden, ".badge", "color"), "rgb(11, 12, 13)")
  const chrome = await browser.newPage()
  // Frames above load straight from the dev server; the chrome is the Caliper app's (decision 37).
  app = await startApp()
  await chrome.goto(`${await projectBase(app, root)}__caliper/`)
  await chrome.locator(cal.setup).waitFor()
  await reveal(chrome, chrome.locator(cal.setup).getByText(/^src\/legacy.css/))
  assert.match(await chrome.locator(cal.setup).innerText(), /Set by caliper\(\{ css \}\) in vite.config/)
  assert.match(await chrome.locator(cal.setup).innerText(), /src\/legacy.css/)
  console.log("PASS: explicit globals, existing global CSS import chains, tagged global overrides and Setup provenance")
} finally {
  await browser.close()
  await app?.close()
  await server?.close()
  rmSync(root, { recursive: true, force: true })
}
