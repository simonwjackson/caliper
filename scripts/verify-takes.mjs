#!/usr/bin/env -S nix shell nixpkgs#nodejs --command node
// @ts-check
/**
 * Check canvas takes in a real browser, against a running project dev
 * server whose caliper() has an agent. It calls the real model.
 *
 *   CHROMIUM=/path/to/chromium node scripts/verify-takes.mjs \
 *     --url http://127.0.0.1:5173 --part src/ui/atoms/Button.atom.part.tsx \
 *     --prompt "Make the button red" [--takes 2] [--out /tmp/caliper-takes]
 *     [--state MissingArt --context-part src/Home.page.part.tsx --context-state NoArtwork]
 *
 * It types the prompt in the chrome, starts the takes, waits until every
 * agent is done, checks that a plan of 3 or more takes marks one strange
 * direction or says why it has none (decision 33), checks that each take frame renders, and takes screenshots
 * of the chrome at three window sizes. It discards the takes at the end, so
 * the project's files do not change.
 */
import assert from "node:assert/strict"
import { mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { chromium } from "playwright-core"
import { cal, deferLayout, reveal, waitFrames, waitTakes } from "./verify-helpers.mjs"

const { values: args } = parseArgs({
  options: {
    url: { type: "string" },
    part: { type: "string" },
    state: { type: "string", default: "default" },
    "context-part": { type: "string" },
    "context-state": { type: "string", default: "default" },
    prompt: { type: "string" },
    takes: { type: "string", default: "2" },
    out: { type: "string", default: "/tmp/caliper-takes" },
    keep: { type: "boolean", default: false },
    // Accept the first take through the chrome and check that its files replaced the real ones.
    accept: { type: "boolean", default: false },
    root: { type: "string" },
  },
})
if (!args.url || !args.part || !args.prompt) throw new Error("Pass --url, --part and --prompt.")
const executablePath = process.env.CHROMIUM
if (!executablePath) throw new Error("Set CHROMIUM to a Chromium executable.")
const out = /** @type {string} */ (args.out)
mkdirSync(out, { recursive: true })
const count = Number(args.takes)
const base = new URL("__caliper/", args.url).href

const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
/** @type {string[]} */
const failures = []
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } })
  // Accept and Discard confirm; one handler answers every confirm in the run.
  page.on("dialog", dialog => void dialog.accept())
  page.on("pageerror", error => failures.push(`chrome page error: ${error.message}`))
  const selection = new URLSearchParams({ part: args.part, state: args.state, device: "rg353m" })
  if (args["context-part"]) {
    selection.set("contextPart", args["context-part"])
    selection.set("contextState", args["context-state"])
  }
  await page.goto(`${base}#${selection}`)
  await (await reveal(page, page.locator(cal.agent))).filter({ hasNotText: "Connecting" }).waitFor()
  assert.equal(await page.locator(`${cal.nav} ${cal.part}[aria-current="true"]`).getAttribute("data-part"), args.part, `${args.part} is a part of the project`)
  if (args["context-part"]) {
    assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("contextPart"), args["context-part"], "the selected context is declared")
  }
  const agent = await page.locator(cal.agent).textContent()
  console.log(`agent: ${agent}`)
  assert(!(await page.locator(cal.prompt).isDisabled()), "the prompt box is enabled, so the agent is ready")

  assert(Number.isInteger(count) && count >= 1 && count <= 4, "--takes is 1 to 4")
  /** @type {import('../src/types').TakesSnapshot} */
  const initial = await (await fetch(new URL("takes.json", base))).json()
  const before = new Set(initial.takes.map(take => take.take))
  const countControl = await reveal(page, page.locator(cal.count))
  // The reference renderer uses a select; the Darkroom New take menu uses menu radios.
  if (await countControl.evaluate(node => node instanceof HTMLSelectElement)) await countControl.selectOption(String(count))
  else await countControl.locator(`[data-count="${count}"]`).click()
  await page.locator(cal.prompt).fill(/** @type {string} */ (args.prompt))
  const started = Date.now()
  const planning = count > 1 ? page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/takes/plan") && response.request().method() === "POST", { timeout:120_000 }) : null
  await page.locator(cal.start).click()
  let startedTakes = count
  if (count > 1) {
    // Several takes: the planner proposes one direction per take, and every direction starts at once.
    // There is no review step (decision 16, changed 2026-09-30).
    await page.locator(cal.plan).waitFor({ timeout:10_000 })
    await page.screenshot({ path: join(out, "plan.png") })
    assert(planning)
    const response = await planning
    assert(response.ok(), await response.text())
    /** @type {{ directions: import('../src/types').Direction[], note?: string }} */
    const planned = await response.json()
    console.log(`planned in ${Math.round((Date.now() - started) / 1000)} s: ${JSON.stringify(planned, null, 1)}`)
    startedTakes = planned.directions.length
    assert(startedTakes >= 1 && startedTakes <= count, "the planner proposes 1 to count directions")
    const strange = planned.directions.filter(direction => direction.strange).length
    if (count >= 3) assert(strange === 1 || (strange === 0 && !!planned.note?.trim()), "a plan of 3 or more takes has one strange direction, or a note that says why not")
    else assert.equal(strange, 0, "a plan of 2 takes has no strange direction")
  }
  await page.waitForFunction(({selector,before,n}) => [...document.querySelectorAll(selector)].filter(node => !before.includes(node.getAttribute("data-take") ?? "")).length === n, { selector:`${cal.nav} ${cal.navTake}`, before:[...before], n:startedTakes }, { timeout:60_000 })
  const ids = await page.locator(`${cal.nav} ${cal.navTake}`).evaluateAll((nodes, before) => nodes.map(node => node.getAttribute("data-take") ?? "").filter(id => !before.includes(id)), [...before])
  assert.equal(new Set(ids).size, startedTakes, "every launch has its own identity")
  assert.equal(await page.locator(cal.plan).count(), 0, "the plan is gone once its takes start")
  console.log(`${startedTakes} takes started; the stage shows ${await page.locator(cal.frame).count()} frames`)
  await page.screenshot({ path: join(out, "working.png") })

  const takes = await waitTakes(base, ids, 600_000)
  console.log(`every agent is done after ${Math.round((Date.now() - started) / 1000)} s`)
  for (const take of takes) assert.equal(take.run._tag, "Idle", `${take.take} did not fail: ${JSON.stringify(take.run)}`)
  await page.waitForTimeout(1500)
  // Product-document verdicts, not reference figure attributes.
  const frameCount = await page.locator(cal.frame).count()
  assert(frameCount >= startedTakes + 1, "original and every launched take have frames")
  await waitFrames(page, frameCount)
  for (const id of ids) assert.equal(await page.locator(`${cal.frame}[data-take="${id}"]`).count(), 1, `${id} renders once`)
  if (args["context-part"]) {
    const snapshot = await (await fetch(new URL("takes.json", base))).json()
    const selected = snapshot.takes.filter((/** @type {import("../src/types").TakeView} */ take) => take.part === args.part && take.state === args.state)
    assert(selected.some((/** @type {import("../src/types").TakeView} */ take) => take.context?.part === args["context-part"] && take.context?.state === args["context-state"]), "the take records its subject and composed context")
  }
  const log = await page.locator(cal.log).innerText()
  console.log(`log of the selected take:\n${log.slice(0, 1500)}`)

  for (const [name, width, height] of [["wide", 1800, 1000], ["medium", 1200, 900], ["narrow", 600, 900]]) {
    await page.setViewportSize({ width: /** @type {number} */ (width), height: /** @type {number} */ (height) })
    await page.waitForTimeout(400)
    await page.screenshot({ path: join(out, `${name}.png`) })
    for (const selector of [cal.prompt, cal.start, cal.discard]) {
      const control = await reveal(page, page.locator(selector).first())
      assert(await control.isVisible(), `${selector} remains reachable at ${name}; layout fit deferred`)
    }
    await (await reveal(page, page.locator(`${cal.nav} ${cal.navTake}[data-take="${ids[0]}"]`))).click()
    assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("take"), ids[0], `take selection works at ${name}`)
  }

  deferLayout(["Zero page/root scroll at 1800×1000, 1200×900 and 600×900", "Prompt/start/take actions fully inside the viewport or one tap away in their own region at those three sizes"])
  if (args.accept) {
    assert(args.root, "--accept needs --root, the project folder, to check the real files")
    const root = /** @type {string} */ (args.root)
    await page.setViewportSize({ width:1800,height:1000 })
    const [chosen, ...rest] = ids
    /** @type {import('../src/types').TakesSnapshot} */
    const snapshot = await (await fetch(new URL("takes.json", base))).json()
    const record = snapshot.takes.find(take => take.take === chosen)
    assert(record && record.files.length > 0, `take ${chosen} changed at least one file`)
    const copies = Object.fromEntries(record.files.map(file => [file, readFileSync(join(root, ".caliper/takes", /** @type {string} */ (chosen), file), "utf8")]))
    await (await reveal(page, page.locator(`${cal.nav} ${cal.navTake}[data-take="${chosen}"]`))).click()
    await (await reveal(page, page.locator(`${cal.accept}[data-take="${chosen}"]`))).click()
    await page.locator(`${cal.nav} ${cal.navTake}[data-take="${chosen}"]`).waitFor({ state:"detached", timeout:60_000 })
    for (const [file, text] of Object.entries(copies)) assert.equal(readFileSync(join(root, file), "utf8"), text, `${file} now holds take ${chosen}'s version`)
    for (const id of rest) assert.equal(await page.locator(`${cal.nav} ${cal.navTake}[data-take="${id}"]`).count(), 1, `take ${id} stays after another take is accepted`)
    await waitFrames(page, await page.locator(cal.frame).count(), "settled")
    await page.screenshot({ path: join(out, "accepted.png") })
    console.log(`accepted take ${chosen}: ${record.files.join(", ")} replaced the real files; ${rest.length} other takes remain`)
    ids.splice(0, ids.length, ...rest)
  }
  if (!args.keep) {
    // One handler for the whole run: accept and discard each confirm once.
    await page.setViewportSize({ width:1800,height:1000 })
    for (const id of ids) {
      await (await reveal(page, page.locator(`${cal.nav} ${cal.navTake}[data-take="${id}"]`))).click()
      await (await reveal(page, page.locator(`${cal.discard}[data-take="${id}"]`))).click()
      await page.locator(`${cal.nav} ${cal.navTake}[data-take="${id}"]`).waitFor({ state:"detached" })
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
console.log(`ok · behavioral checks passed; layout NOT PROVEN · screenshots in ${out}`)
