import assert from "node:assert/strict"
import { mkdirSync, symlinkSync } from "node:fs"
import { join, resolve } from "node:path"
import { chromium } from "playwright-core"
import { cal, deferLayout, reveal, waitFrames } from "../scripts/verify-helpers.mjs"
import { manifest, withProject } from "./project-server.js"

const modules = process.env.CALIPER_TEST_MODULES
assert(modules && process.env.CHROMIUM, "Set CHROMIUM and CALIPER_TEST_MODULES")
const home = "independent/ZHome.page.part.tsx"
const other = "elsewhere/Other.page.part.tsx"
const base = 'import React from "react"\nexport default function Part() { return React.createElement("p", null, "Default fixture") }\n'
const states = `${base}export const Busy = () => React.createElement("p", null, "Busy fixture")\nexport const Empty = () => React.createElement("p", null, "Empty fixture")\n`
const files = {
  "package.json": manifest(), "src/index.ts": "export {}",
  [home]: `export const name = "Home"\n${states}`,
  [other]: `export const name = "Other"\n${states}`,
  "wherever/Layout.template.part.tsx": base, "wherever/Shelf.organism.part.tsx": base,
  "wherever/Item.molecule.part.tsx": base, "wherever/Button.atom.part.tsx": base,
  "atoms/Declared.part.tsx": `export const layer = "page"\n${base}`,
  "pages/Unknown.part.tsx": base, "misc/Unknown.part.tsx": base,
}
deferLayout([
  "Navigation layer headings (reference has no grouped headings)",
  "True-size frame widths and equal drawn widths at the five size-ladder shapes",
  "44 × 44 disclosure hit areas; drawer/overflow one-tap policy",
  "Zero page/list overflow at the five size-ladder shapes",
])
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
try {
  await withProject({ files, options: { wrap: false, css: [] } }, async ({ root, url, write }) => {
    mkdirSync(join(root, "node_modules"), { recursive: true })
    for (const dependency of ["react", "react-dom"]) symlinkSync(resolve(modules, dependency), join(root, "node_modules", dependency), "dir")
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
    page.setDefaultTimeout(15_000)
    await page.addInitScript(() => localStorage.setItem("caliper:px-per-mm", "4"))
    const errors: string[] = []
    page.on("pageerror", error => errors.push(error.message))
    await page.goto(`${url}__caliper/#${new URLSearchParams({ part: home, state: "Busy", device: "rg353m" })}`)
    const nav = page.locator(cal.nav)
    const homeButton = nav.locator(`${cal.part}[data-part="${home}"]`)
    const homeStates = nav.locator(`${cal.state}[data-part="${home}"]`)
    const otherStates = nav.locator(`${cal.state}[data-part="${other}"]`)
    const toggle = nav.locator(`${cal.partExpand}[data-part="${home}"]`)
    await homeButton.waitFor()
    await waitFrames(page, 1)
    assert.deepEqual(await nav.locator(cal.part).evaluateAll(nodes => nodes.map(node => node.getAttribute("data-part"))), [
      "atoms/Declared.part.tsx", other, home,
      "wherever/Layout.template.part.tsx", "wherever/Shelf.organism.part.tsx", "wherever/Item.molecule.part.tsx", "wherever/Button.atom.part.tsx",
      "misc/Unknown.part.tsx", "pages/Unknown.part.tsx",
    ])
    assert.equal(await homeStates.filter({ hasText: "Busy" }).getAttribute("aria-current"), "true")
    assert((await page.frameLocator(cal.frame).locator("body").innerText()).includes("Busy fixture"))
    assert.equal(await nav.locator(`${cal.state}[data-state="*"]`).count(), 0)

    await homeButton.focus()
    await page.keyboard.press("Enter")
    await waitFrames(page, 3)
    assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("state"), "*")
    assert.equal(await homeButton.evaluate(node => node === document.activeElement), true)
    for (const iframe of await page.locator(cal.frame).all()) assert.equal(await iframe.evaluate(node => (node as HTMLIFrameElement).contentWindow?.innerWidth), 640)

    const allUrl = page.url()
    await toggle.focus()
    await page.keyboard.press("Tab")
    assert.equal(await homeButton.evaluate(node => node === document.activeElement), true)
    await page.keyboard.press("Tab")
    assert.equal(await homeStates.and(page.getByRole("button", { name:"Default", exact:true })).evaluate(node => node === document.activeElement), true)
    await toggle.focus()
    await page.keyboard.press("Space")
    assert.equal(await homeStates.count(), 0)
    assert.equal(page.url(), allUrl)
    assert.equal(await toggle.evaluate(node => node === document.activeElement), true)
    assert.equal(await toggle.getAttribute("aria-expanded"), "false")
    await page.keyboard.press("Enter")
    assert.equal(await homeStates.count(), 3)
    await homeStates.and(page.getByRole("button", { name:"Empty", exact:true })).focus()
    await page.keyboard.press("Space")
    await waitFrames(page, 1)
    assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("state"), "Empty")
    await page.reload()
    await nav.locator(`${cal.state}[data-part="${home}"][aria-current="true"]`).waitFor()
    assert.equal(await nav.locator(`${cal.state}[data-part="${home}"][aria-current="true"]`).innerText(), "Empty")

    const beforeExpand = page.url()
    await nav.locator(`${cal.partExpand}[data-part="${other}"]`).click()
    assert.equal(page.url(), beforeExpand)
    await otherStates.and(page.getByRole("button", { name:"Busy", exact:true })).click()
    assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("part"), other)
    assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("state"), "Busy")
    await homeButton.click()
    assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("state"), "*")

    const search = page.getByRole("searchbox", { name: "Filter parts" })
    await search.fill("wherever")
    assert.equal(await nav.locator(cal.part).count(), 4)
    assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("part"), home)
    await search.fill("Home")
    assert.equal(await nav.locator(cal.part).count(), 1)
    await search.fill("")
    await page.reload()
    await waitFrames(page, 3)

    write("pages/Unknown.part.tsx", `export const layer = "page"\n${base}`)
    await page.waitForFunction(selector => [...document.querySelectorAll(selector)].findIndex(node => node.getAttribute("data-part") === "pages/Unknown.part.tsx") === 3, cal.part)

    mkdirSync("/tmp/caliper-navigation", { recursive: true })
    for (const size of [{ width: 1600, height: 1000 }, { width: 900, height: 700 }, { width: 420, height: 900 }, { width: 1280, height: 300 }, { width: 320, height: 480 }]) {
      await page.setViewportSize(size)
      await (await reveal(page, homeButton)).click()
      await (await reveal(page, toggle)).click()
      assert.equal(await homeStates.count(), 0)
      await toggle.click()
      assert.equal(await homeStates.count(), 3)
      await homeStates.and(page.getByRole("button", { name:"Busy", exact:true })).click()
      assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("state"), "Busy")
      await (await reveal(page, homeButton)).click()
      await waitFrames(page, 3)
      for (const iframe of await page.locator(cal.frame).all()) assert.equal(await iframe.evaluate(node => (node as HTMLIFrameElement).contentWindow?.innerWidth), 640)
      await page.screenshot({ path: `/tmp/caliper-navigation/${size.width}x${size.height}.png` })
    }
    assert.deepEqual(errors, [])
    await page.close()
    console.log("PASS: layer order, independent disclosure, keyboard/focus, named/all states, search, deep links, source reclassification and five behavioral size samples; layout deferred")
  })
} finally { await browser.close() }
