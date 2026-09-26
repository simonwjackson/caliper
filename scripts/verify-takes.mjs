#!/usr/bin/env node
// @ts-check
/**
 * Check the takes panel in a real browser, against a running project dev
 * server whose caliper() has an agent. It calls the real model.
 *
 *   CHROMIUM=/path/to/chromium node scripts/verify-takes.mjs \
 *     --url http://127.0.0.1:5173 --part src/ui/atoms/Button.atom.part.tsx \
 *     --prompt "Make the button red" [--takes 2] [--out /tmp/caliper-takes]
 *
 * It types the prompt in the chrome, starts the takes, waits until every
 * agent is done, checks that each take frame renders, and takes screenshots
 * of the chrome at three window sizes. It discards the takes at the end, so
 * the project's files do not change.
 */
import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { chromium } from "playwright-core"

const { values: args } = parseArgs({
  options: {
    url: { type: "string" },
    part: { type: "string" },
    prompt: { type: "string" },
    takes: { type: "string", default: "2" },
    out: { type: "string", default: "/tmp/caliper-takes" },
    keep: { type: "boolean", default: false },
  },
})
if (!args.url || !args.part || !args.prompt) throw new Error("Pass --url, --part and --prompt.")
const executablePath = process.env.CHROMIUM
if (!executablePath) throw new Error("Set CHROMIUM to a Chromium executable.")
const out = /** @type {string} */ (args.out)
mkdirSync(out, { recursive: true })
const count = Number(args.takes)
const base = new URL("/__caliper/", args.url).href

const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
/** @type {string[]} */
const failures = []
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } })
  page.on("pageerror", error => failures.push(`chrome page error: ${error.message}`))
  await page.goto(base)
  await page.evaluate(() => localStorage.setItem("caliper:takes-open", "true"))
  await page.goto(`${base}#part=${encodeURIComponent(args.part)}&device=rg353m`)
  await page.locator(".cal-agent").filter({ hasNotText: "Connecting" }).waitFor()
  assert.equal(await page.locator('.cal-part[aria-current="true"]').getAttribute("title"), args.part, `${args.part} is a part of the project`)
  const agent = await page.locator(".cal-agent").textContent()
  console.log(`agent: ${agent}`)
  assert(!(await page.locator(".cal-prompt").isDisabled()), "the prompt box is enabled, so the agent is ready")

  const before = new Set(await page.locator(".cal-take").evaluateAll(rows => rows.map(row => row.textContent)))
  await page.locator(".cal-parallel select").selectOption(String(count))
  await page.locator(".cal-prompt").fill(/** @type {string} */ (args.prompt))
  const started = Date.now()
  await page.locator(".cal-start").click()
  await page.waitForFunction(n => document.querySelectorAll(".cal-take").length >= n, before.size + count)
  console.log(`${count} takes started; the stage shows ${await page.locator(".cal-cell").count()} frames`)
  await page.screenshot({ path: join(out, "working.png") })

  await page.waitForFunction(() => document.querySelectorAll('.cal-take[data-run="Running"]').length === 0, undefined, { timeout: 600_000 })
  console.log(`every agent is done after ${Math.round((Date.now() - started) / 1000)} s`)
  // Frames reload when their agent finishes; wait for each to report.
  await page.waitForFunction(() => [...document.querySelectorAll(".cal-cell")].every(cell => /** @type {HTMLElement} */ (cell).dataset.frameState !== "Loading"), undefined, { timeout: 30_000 })
  await page.waitForTimeout(1500)

  const takes = await page.locator(".cal-take").evaluateAll(rows => rows.map(row => ({
    name: row.querySelector("strong")?.textContent,
    status: row.querySelector(".cal-take-status")?.textContent,
    run: /** @type {HTMLElement} */ (row).dataset.run,
  })))
  console.log(JSON.stringify(takes))
  for (const take of takes) assert.notEqual(take.run, "Failed", `${take.name} did not fail`)
  const cells = await page.locator(".cal-cell").evaluateAll(all => all.map(cell => ({
    key: /** @type {HTMLElement} */ (cell).dataset.key,
    frame: /** @type {HTMLElement} */ (cell).dataset.frameState,
  })))
  console.log(JSON.stringify(cells))
  for (const cell of cells) assert.equal(cell.frame, "Rendered", `${cell.key} rendered`)
  const log = await page.locator(".cal-log").innerText()
  console.log(`log of the selected take:\n${log.slice(0, 1500)}`)

  for (const [name, width, height] of [["wide", 1800, 1000], ["medium", 1200, 900], ["narrow", 600, 900]]) {
    await page.setViewportSize({ width: /** @type {number} */ (width), height: /** @type {number} */ (height) })
    await page.waitForTimeout(400)
    await page.screenshot({ path: join(out, `${name}.png`), fullPage: name === "narrow" })
    // Every control stays reachable at every size.
    for (const selector of [".cal-prompt", ".cal-start", ".cal-take-actions button"]) {
      const box = await page.locator(selector).first().boundingBox()
      assert(box !== null && box.width > 0 && box.height > 0, `${selector} is visible at ${name}`)
    }
  }

  if (!args.keep) {
    page.on("dialog", dialog => dialog.accept())
    await page.setViewportSize({ width: 1800, height: 1000 })
    while (await page.locator(".cal-take").count() > before.size) {
      const n = await page.locator(".cal-take").count()
      await page.locator(".cal-take").last().getByRole("button", { name: "Discard" }).click()
      await page.waitForFunction(m => document.querySelectorAll(".cal-take").length < m, n)
    }
  }
} catch (error) {
  failures.push(error instanceof Error ? error.stack ?? error.message : String(error))
} finally {
  await browser.close()
}
if (failures.length) {
  console.error(failures.join("\n\n"))
  process.exit(1)
}
console.log(`ok · screenshots in ${out}`)
