#!/usr/bin/env -S nix shell nixpkgs#nodejs --command node
/**
 * Run the Knobs panel on a copy of a real project, and report what it finds.
 * The project's own files never change: Caliper works on a temporary copy,
 * with the project's node_modules linked in.
 *
 *   CHROMIUM=/path/to/chromium node scripts/verify-knobs-product.mjs \
 *     --root ~/code/sandbox/korri/surfaces/pico --with ../../contracts \
 *     --part src/ui/organisms/PicoGameStage.organism.part.tsx
 *
 * `--with` copies another folder the project imports from, at the same place
 * relative to the root. The script prints every knob and every refusal, then
 * drags the first number knob of a property and the first `@container`
 * threshold, and checks for each that every frame changed during the drag and
 * that the file changed once, on release.
 */
import assert from "node:assert/strict"
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"
import { parseArgs } from "node:util"
import { createServer } from "vite"
import { chromium } from "playwright-core"
import { caliper } from "../src/plugin.js"

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
  page.on("pageerror", error => errors.push(error.message))
  /** @type {string[]} */
  const writes = []
  page.on("request", request => { if (request.url().includes("/knobs/write")) writes.push(request.postData() ?? "") })
  await page.addInitScript(() => {
    localStorage.setItem("caliper:knobs-open", "true")
    localStorage.setItem("caliper:side", "knobs")
  })
  const started = Date.now()
  await page.goto(`${url}__caliper/#part=${encodeURIComponent(values.part)}&state=${encodeURIComponent(values.state ?? "default")}`)
  await page.locator(".cal-knobs[data-view='Ready']").waitFor({ timeout: 60000 })
  console.log(`Knobs ready ${Date.now() - started} ms after the page opened.\n`)
  const knobs = await page.locator(".cal-knob").evaluateAll(rows => rows.map(row => ({
    label: row.querySelector(".cal-knob-label")?.textContent ?? "",
    control: /** @type {HTMLElement} */ (row).dataset.control ?? "",
    site: row.querySelector(".cal-knob-site")?.textContent ?? "",
    value: /** @type {HTMLInputElement | null} */ (row.querySelector("input"))?.value ?? row.querySelector(".cal-knob-token code")?.textContent ?? "",
  })))
  console.log("Knobs:")
  for (const knob of knobs) console.log(`  ${knob.label.padEnd(16)} ${knob.control.padEnd(7)} ${knob.value.padEnd(12)} ${knob.site}`)
  const skipped = await page.locator(".cal-knobs-skipped li").allTextContents()
  console.log("\nNot knobs:")
  for (const line of skipped) console.log(`  ${line}`)

  /**
   * What each frame shows for a knob: a property's value on the part's first
   * element, or the conditions of every `@container` rule.
   *
   * @param {string} origin
   * @param {string} name
   */
  const shown = (origin, name) => page.evaluate(([origin, name]) => [...document.querySelectorAll("iframe.cal-frame[src]")].map(iframe => {
    const frame = /** @type {HTMLIFrameElement} */ (iframe)
    if (origin === "Plain") {
      // A plain property need not reach the part's first element: read its declarations.
      return [...(frame.contentDocument?.styleSheets ?? [])].flatMap(sheet => {
        /** @param {CSSRuleList} list @returns {string[]} */
        const values = list => [...list].flatMap(rule => [
          ...("style" in rule && rule.constructor.name === "CSSStyleRule" ? [/** @type {CSSStyleRule} */ (rule).style.getPropertyValue(name)] : []),
          ...("cssRules" in rule && rule.constructor.name !== "CSSKeyframesRule" ? values(/** @type {CSSGroupingRule} */ (rule).cssRules) : []),
        ]).filter(Boolean)
        return values(sheet.cssRules)
      }).join(" | ")
    }
    if (origin === "Threshold") {
      return [...(frame.contentDocument?.styleSheets ?? [])].flatMap(sheet => [...sheet.cssRules].flatMap(rule => ("conditionText" in rule && rule.constructor.name === "CSSContainerRule" ? [String(rule.conditionText)] : []))).join(" | ")
    }
    const element = frame.contentDocument?.querySelector("#caliper-host *")
    return element ? frame.contentWindow?.getComputedStyle(element).getPropertyValue(name) : null
  }), [origin, name])

  for (const origin of ["Property", "Plain", "Threshold"]) {
    const row = page.locator(`.cal-knob[data-control='Number'][data-origin='${origin}']`).first()
    if ((await row.count()) === 0) {
      console.log(`\nNo ${origin.toLowerCase()} number knob to drag.`)
      continue
    }
    writes.length = 0
    const site = /** @type {string} */ (await row.locator(".cal-knob-site code").textContent())
    const file = await row.locator(".cal-knob-file").textContent()
    const before = await shown(origin, site)
    const label = row.locator(".cal-knob-label")
    await label.scrollIntoViewIfNeeded()
    const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await label.boundingBox())
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + 5, y)
    await page.mouse.down()
    for (let dx = 2; dx <= 20; dx += 2) {
      await page.mouse.move(box.x + 5 + dx, y)
      await page.waitForTimeout(16)
    }
    const during = await shown(origin, site)
    assert.equal(writes.length, 0, "no write during the drag")
    await page.mouse.up()
    await page.waitForTimeout(1500)
    console.log(origin !== "Threshold"
      ? `\nDragged ${site} (${file}): ${before.join(", ")} -> ${during.join(", ")} in ${during.length} frames; ${writes.length} write on release.`
      : `\nDragged a threshold (${file}) in ${during.length} frames; ${writes.length} write on release.\n  before: ${before[0]}\n  during: ${during[0]}`)
    assert(during.every((value, index) => value !== before[index]), "every frame changed during the drag")
    assert.equal(writes.length, 1, "one write, on release")
    const body = JSON.parse(writes[0] ?? "{}")
    const text = readFileSync(join(root, body.file), "utf8")
    assert.equal(text.slice(body.start, body.start + body.value.length), body.value, "the file holds the value")
    console.log(`Wrote ${body.value} into ${body.file} at offset ${body.start}; the real project is untouched.`)
    // Let the panel find the knobs again after the write, before the next drag.
    await page.waitForTimeout(3500)
  }
  // Literals: list them, then make the first one that has a home a token, and
  // check that no element of the part changes its value.
  const opened = Date.now()
  await page.locator(".cal-knobs-literals > summary").click()
  await page.waitForFunction(() => /Literals \(\d+\)/.test(document.querySelector(".cal-knobs-literals > summary")?.textContent ?? ""), null, { timeout: 60000 })
  const literals = await page.locator(".cal-literal").evaluateAll(rows => rows.map(row => `${row.querySelector(".cal-literal-value")?.textContent} ${row.querySelector(".cal-knob-site")?.textContent}`))
  console.log(`\nLiterals: ${literals.length}, found ${Date.now() - opened} ms after the section opened.`)
  for (const line of literals.slice(0, 12)) console.log(`  ${line}`)
  if (literals.length > 12) console.log(`  … and ${literals.length - 12} more`)
  const unplaced = await page.locator(".cal-knobs-literals .cal-knobs-skipped li").allTextContents()
  if (unplaced.length) console.log(`Literals Caliper could not place: ${unplaced.length}`)
  for (const line of unplaced) console.log(`  ${line}`)
  /** @param {string} property */
  const valuesOf = property => page.evaluate(name => [...document.querySelectorAll("iframe.cal-frame[src]")].flatMap(iframe => {
    const frame = /** @type {HTMLIFrameElement} */ (iframe)
    const host = frame.contentDocument?.getElementById("caliper-host")
    return host ? [host, ...host.querySelectorAll("*")].map(element => frame.contentWindow?.getComputedStyle(element).getPropertyValue(name)) : []
  }).join("|"), property)
  for (let index = 0; index < literals.length; index++) {
    const row = page.locator(".cal-literal").nth(index)
    await row.getByRole("button", { name: "Make a token" }).click()
    if ((await row.locator("select.cal-literal-home").count()) === 0) {
      await row.getByRole("button", { name: "Cancel" }).click()
      continue
    }
    const [property = "", value = ""] = (await row.locator(".cal-literal-value").innerText()).split(": ")
    const suggested = await row.locator("input.cal-literal-name").inputValue()
    console.log(`\nMaking ${property}: ${value} a token. Caliper suggests ${suggested}.\n  ${await row.locator(".cal-literal-preview").innerText()}`)
    const before = await valuesOf(property)
    await row.locator("input.cal-literal-name").fill("--caliper-check-token")
    const answer = page.waitForResponse(response => response.url().includes("/knobs/promote"))
    await row.getByRole("button", { name: "Create token" }).click()
    const result = await (await answer).json()
    assert.equal(result._tag, "Promoted", JSON.stringify(result))
    await page.locator('.cal-knob[data-knob$="#--caliper-check-token"]').waitFor({ timeout: 10000 })
    const after = await valuesOf(property)
    assert.equal(after, before, "every element of the part keeps its value")
    console.log(`Edited ${result.files.join(" and ")}; ${before.split("|").length} elements kept their ${property}; the new token has a knob.`)
    break
  }
  await page.screenshot({ path: "/tmp/caliper-verify-knobs-product.png" })
  assert.deepEqual(errors, [], "the chrome threw no errors")
  console.log("\nScreenshot: /tmp/caliper-verify-knobs-product.png")
} finally {
  await browser.close()
  await server.close()
  rmSync(work, { recursive: true, force: true })
}
