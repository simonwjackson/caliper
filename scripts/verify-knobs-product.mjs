#!/usr/bin/env -S nix shell nixpkgs#nodejs_24 --command node
// @ts-check
/** Verify discovery, live input, once-only commits and literal promotion on a disposable project copy. */
import assert from "node:assert/strict"
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"
import { parseArgs } from "node:util"
import { createServer } from "vite"
import { chromium } from "playwright-core"
import { caliper } from "../src/plugin.js"
import { cal, deferLayout, reveal } from "./verify-helpers.mjs"

const { values } = parseArgs({ options: {
  root: { type: "string" }, with: { type: "string", multiple: true }, part: { type: "string" },
  state: { type: "string" }, width: { type: "string" }, height: { type: "string" },
} })
assert(values.root && values.part && process.env.CHROMIUM, "Pass --root and --part, and set CHROMIUM")
const source = resolve(values.root)
const extras = (values.with ?? []).map(dir => resolve(source, dir))
const depth = Math.max(0, ...extras.map(dir => relative(dir, source).split("/").filter(segment => segment !== "..").length))
const base = resolve(source, ...Array(depth).fill(".."))
const work = mkdtempSync(join(tmpdir(), "caliper-knobs-product-"))
const root = join(work, relative(base, source))
const skip = (/** @type {string} */ path) => !/\/(node_modules|\.caliper|\.git|\.vite[^/]*)(\/|$)/.test(path)
cpSync(source, root, { recursive: true, filter: skip })
for (const dir of extras) cpSync(dir, join(work, relative(base, dir)), { recursive: true, filter: skip })
symlinkSync(join(source, "node_modules"), join(root, "node_modules"), "dir")
const server = await createServer({ root, cacheDir: join(root, ".vite-knobs"), configFile: false, logLevel: "silent", plugins: [caliper()], server: { host: "127.0.0.1", port: 0 } })
await server.listen()
const url = server.resolvedUrls?.local[0] ?? ""
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
try {
  const page = await browser.newPage({ viewport: { width: Number(values.width ?? 1600), height: Number(values.height ?? 1000) } })
  /** @type {string[]} */
  const errors = []
  /** @type {string[]} */
  const writes = []
  page.on("pageerror", error => errors.push(error.message))
  page.on("request", request => { if (request.url().includes("/knobs/write")) writes.push(request.postData() ?? "") })
  await page.addInitScript(() => { localStorage.setItem("caliper:knobs-open", "true"); localStorage.setItem("caliper:side", "knobs") })
  const started = Date.now()
  await page.goto(`${url}__caliper/#part=${encodeURIComponent(values.part)}&state=${encodeURIComponent(values.state ?? "default")}`)
  const knobs = page.locator(cal.knobs)
  await (await reveal(page, knobs)).waitFor()
  // Literals exists only in a completed Ready snapshot, including zero-knob results.
  // An Idle message while the product frame loads must not pass discovery.
  await knobs.locator(cal.literals).waitFor({ state: "attached", timeout: 60000 })
  console.log(`Knobs ready ${Date.now() - started} ms after the page opened.\n`)
  for (const line of await knobs.locator(cal.knob).allTextContents()) console.log(`  ${line}`)
  console.log("\nDiscovery details and refusals:\n" + await knobs.textContent())

  const registered = await page.evaluate(selector => {
    const names = new Set()
    for (const node of document.querySelectorAll(selector)) {
      const frame = /** @type {HTMLIFrameElement} */ (node)
      for (const sheet of frame.contentDocument?.styleSheets ?? []) {
        const visit = (/** @type {CSSRuleList} */ rules) => {
          for (const rule of rules) {
            if (rule.constructor.name === "CSSPropertyRule") names.add(/** @type {CSSPropertyRule} */ (rule).name)
            if ("cssRules" in rule && rule.constructor.name !== "CSSKeyframesRule") visit(/** @type {CSSGroupingRule} */ (rule).cssRules)
          }
        }
        visit(sheet.cssRules)
      }
    }
    return [...names]
  }, cal.frame)
  /** @param {string} origin @param {string} name */
  const shown = (origin, name) => page.evaluate(({ selector, origin, name }) => [...document.querySelectorAll(selector)].map(node => {
    const frame = /** @type {HTMLIFrameElement} */ (node)
    if (origin === "Property") {
      const element = frame.contentDocument?.querySelector("#caliper-host *")
      return element ? frame.contentWindow?.getComputedStyle(element).getPropertyValue(name) : null
    }
    /** @param {CSSRuleList} rules @returns {string[]} */
    const all = rules => [...rules].flatMap(rule => [
      ...(origin === "Threshold" && rule.constructor.name === "CSSContainerRule" ? [/** @type {CSSContainerRule} */ (rule).conditionText] : []),
      ...(origin === "Plain" && rule.constructor.name === "CSSStyleRule" ? [/** @type {CSSStyleRule} */ (rule).style.getPropertyValue(name)] : []),
      ...("cssRules" in rule && rule.constructor.name !== "CSSKeyframesRule" ? all(/** @type {CSSGroupingRule} */ (rule).cssRules) : []),
    ]).filter(Boolean)
    return [...(frame.contentDocument?.styleSheets ?? [])].flatMap(sheet => all(sheet.cssRules)).join(" | ")
  }), { selector: cal.frame, origin, name })

  for (const origin of ["Property", "Plain", "Threshold"]) {
    const rows = knobs.locator(cal.knob)
    let candidate = null
    let property = ""
    for (let index = 0; index < await rows.count(); index++) {
      const row = rows.nth(index)
      if (await row.getByRole("spinbutton").count() === 0) continue
      // Core's stable declaration id is variant + CSSOM site, never a label or UI class.
      const [, key] = JSON.parse(await row.getAttribute("data-knob") ?? "[]")
      if (typeof key !== "string") throw new Error("A knob lacks its declaration identity")
      const name = key.includes("#@container#") ? "@container" : key.split("#").at(-1) ?? ""
      const kind = name === "@container" ? "Threshold" : name === "initial-value" || registered.includes(name) ? "Property" : "Plain"
      if (kind !== origin) continue
      candidate = row
      if (name === "initial-value") {
        // The exact registered name is printed as provenance in the row.
        property = (await row.textContent())?.match(/--[A-Za-z0-9_-]+/)?.[0] ?? ""
      } else property = name
      break
    }
    if (!candidate) { console.log(`\nSKIP: no ${origin.toLowerCase()} number knob in this scenario.`); continue }
    assert(property, "the declaration names its property")
    const input = candidate.getByRole("spinbutton")
    await reveal(page, input)
    const original = Number(await input.inputValue())
    const step = Number(await input.getAttribute("step") ?? 1)
    const max = Number(await input.getAttribute("max") ?? Infinity)
    const min = Number(await input.getAttribute("min") ?? -Infinity)
    const next = original + 10 * step <= max ? original + 10 * step : original - 10 * step
    assert(next >= min && next !== original, "the range permits a live edit")
    const before = await shown(origin, property)
    const file = await candidate.locator(cal.sourceFile).getAttribute("data-file")
    assert(file, "source control identifies its file")
    const originalSource = readFileSync(join(root, file), "utf8")
    writes.length = 0
    await input.fill(String(next))
    const during = await shown(origin, property)
    assert.equal(writes.length, 0, "no write during input")
    assert.equal(readFileSync(join(root, file), "utf8"), originalSource)
    assert(during.length > 0 && during.every((value, index) => value !== before[index]), "every frame changes live")
    await input.blur()
    for (let attempt = 0; attempt < 100 && writes.length === 0; attempt++) await page.waitForTimeout(100)
    await page.waitForTimeout(1000)
    assert.equal(writes.length, 1, "one write on commit")
    const body = JSON.parse(writes[0] ?? "{}")
    const text = readFileSync(join(root, body.file), "utf8")
    assert.equal(text.slice(body.start, body.start + body.value.length), body.value)
    console.log(`\n${origin}: ${property}, ${during.length} live frames, one write of ${body.value} into ${body.file}; real project unchanged.`)
    await page.waitForTimeout(3500)
  }
  const opened = Date.now()
  const section = knobs.locator(cal.literals)
  await reveal(page, section)
  await section.locator("summary").first().click()
  // The reference's notice/status belongs to Ready, even when its notice is empty.
  // Waiting for the absence of Finding can race the disclosure's onToggle event.
  await section.getByRole("status").waitFor({ state: "attached", timeout: 60000 })
  const literals = section.locator(cal.literal)
  const count = await literals.count()
  console.log(`\nLiterals: ${count}, found ${Date.now() - opened} ms after opening.`)
  for (const line of (await literals.allTextContents()).slice(0, 12)) console.log(`  ${line}`)
  /** @param {string} property */
  const valuesOf = property => page.evaluate(({ selector, property }) => [...document.querySelectorAll(selector)].flatMap(node => {
    const frame = /** @type {HTMLIFrameElement} */ (node)
    const host = frame.contentDocument?.getElementById("caliper-host")
    return host ? [host, ...host.querySelectorAll("*")].map(element => frame.contentWindow?.getComputedStyle(element).getPropertyValue(property)) : []
  }).join("|"), { selector: cal.frame, property })
  let promoted = false
  for (let index = 0; index < count; index++) {
    const literal = literals.nth(index)
    await (await reveal(page, literal.locator(cal.literalOpen))).click()
    if (await literal.locator(cal.literalHome).locator("option").count() === 0) { await literal.locator(cal.literalCancel).click(); continue }
    const property = (await literal.textContent())?.match(/^([\w-]+):/)?.[1]
    assert(property, "literal names its property")
    const before = await valuesOf(property)
    await literal.locator(cal.literalName).fill("--caliper-check-token")
    const answer = page.waitForResponse(response => response.url().includes("/knobs/promote"))
    await literal.locator(cal.promote).click()
    const result = await (await answer).json()
    assert.equal(result._tag, "Promoted", JSON.stringify(result))
    await page.locator(cal.knob).filter({ hasText: "--caliper-check-token" }).waitFor({ timeout: 10000 })
    assert.equal(await valuesOf(property), before, "every element retains its value")
    console.log(`Edited ${result.files.join(" and ")}; ${before.split("|").length} elements kept ${property}; the new token has a knob.`)
    promoted = true
    break
  }
  if (!promoted) console.log("SKIP: no promotable literal with a home in this scenario.")
  deferLayout(["Knobs docking/sheet geometry, preview height budget and no page-level hidden scroll", "Final UI label scrubbing/pointer capture; live-input/once-only-commit gates remain active"])
  await page.screenshot({ path: "/tmp/caliper-verify-knobs-product.png" })
  assert.deepEqual(errors, [], "the chrome threw no errors")
  console.log("\nScreenshot: /tmp/caliper-verify-knobs-product.png")
} finally { await browser.close(); await server.close(); rmSync(work, { recursive: true, force: true }) }
