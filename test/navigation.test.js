// @ts-check
import { expect, test } from "bun:test"
import { mkdirSync, symlinkSync } from "node:fs"
import { join, resolve } from "node:path"
import { chromium } from "playwright-core"
import { manifest, withProject } from "./project-server.js"

// Real browser + real React, without adding React to Caliper's dependencies.
// CHROMIUM=/path/to/chromium CALIPER_TEST_MODULES=/react-project/node_modules bun test test/navigation.test.js
const modules = process.env.CALIPER_TEST_MODULES
const home = "independent/ZHome.page.part.tsx"
const other = "elsewhere/Other.page.part.tsx"
const base = 'import React from "react"\nexport default function Part() { return React.createElement("p", null, "Default fixture") }\n'
const states = `${base}export const Busy = () => React.createElement("p", null, "Busy fixture")\nexport const Empty = () => React.createElement("p", null, "Empty fixture")\n`
const files = {
  "package.json": manifest(),
  "src/index.ts": "export {}",
  [home]: `export const name = "Home"\n${states}`,
  [other]: `export const name = "Other"\n${states}`,
  "wherever/Layout.template.part.tsx": base,
  "wherever/Shelf.organism.part.tsx": base,
  "wherever/Item.molecule.part.tsx": base,
  "wherever/Button.atom.part.tsx": base,
  "atoms/Declared.part.tsx": `export const layer = "page"\n${base}`,
  "pages/Unknown.part.tsx": base,
  "misc/Unknown.part.tsx": base,
}

const browserTest = test.skipIf(!process.env.CHROMIUM || !modules)
browserTest("part navigation: layers, independent disclosure, all states, keyboard, search, deep links and size", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
  try {
    await withProject({ files, options: { wrap: false, css: [] } }, async ({ root, url, write }) => {
      mkdirSync(join(root, "node_modules"), { recursive: true })
      for (const dependency of ["react", "react-dom"]) symlinkSync(resolve(/** @type {string} */ (modules), dependency), join(root, "node_modules", dependency), "dir")
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
      await page.addInitScript(() => {
        localStorage.setItem("caliper:px-per-mm", "4")
        localStorage.setItem("caliper:takes-open", "false")
      })
      const errors = /** @type {string[]} */ ([])
      page.on("pageerror", error => errors.push(error.message))
      await page.goto(`${url}__caliper/#${new URLSearchParams({ part: home, state: "Busy", device: "rg353m" })}`)
      const homeButton = page.locator(`.cal-part[title="${home}"]`)
      const homeStates = page.getByRole("group", { name: "Home states", exact: true })
      const otherStates = page.getByRole("group", { name: "Other states", exact: true })
      await homeButton.waitFor()
      await page.waitForFunction(() => document.querySelector(".cal-device")?.getAttribute("data-frame-state") === "Rendered")
      expect(await page.locator(".cal-group").allTextContents()).toEqual(["Pages", "Templates", "Organisms", "Molecules", "Atoms", "Unclassified"])
      expect(await page.locator(".cal-part").evaluateAll(nodes => nodes.map(node => node.getAttribute("title")))).toEqual([
        "atoms/Declared.part.tsx", other, home,
        "wherever/Layout.template.part.tsx", "wherever/Shelf.organism.part.tsx", "wherever/Item.molecule.part.tsx", "wherever/Button.atom.part.tsx",
        "misc/Unknown.part.tsx", "pages/Unknown.part.tsx",
      ])
      expect(await homeStates.locator('[aria-current="true"]').innerText()).toBe("Busy")
      expect(await page.frameLocator(".cal-frame").locator("body").innerText()).toContain("Busy fixture")
      expect(await page.locator('.cal-state[data-state="*"]').count()).toBe(0)

      // The group selects all states, even when a child of that group was active.
      await homeButton.focus()
      await page.keyboard.press("Enter")
      await page.waitForFunction(() => [...document.querySelectorAll(".cal-cell")].length === 3 && [...document.querySelectorAll(".cal-cell")].every(cell => cell.getAttribute("data-frame-state") === "Rendered"))
      expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("state")).toBe("*")
      expect(await homeButton.evaluate(node => node === document.activeElement)).toBe(true)
      expect(await page.locator(".cal-grid-caption").innerText()).toContain("True size")
      const widths = await page.locator(".cal-cell .cal-screen").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width))
      expect(widths).toHaveLength(3)
      for (const width of widths) expect(Math.abs(width - 72 * 4)).toBeLessThan(1)
      for (const iframe of await page.locator(".cal-cell iframe").all()) {
        expect(await iframe.evaluate(node => /** @type {HTMLIFrameElement} */ (node).contentWindow?.innerWidth)).toBe(640)
      }

      // Disclosure changes neither selection nor the grid. Space and Enter work.
      const allUrl = page.url()
      await page.getByRole("button", { name: "Collapse Home states", exact: true }).focus()
      await page.keyboard.press("Tab")
      expect(await homeButton.evaluate(node => node === document.activeElement)).toBe(true)
      await page.keyboard.press("Tab")
      expect(await homeStates.getByRole("button", { name: "Default", exact: true }).evaluate(node => node === document.activeElement)).toBe(true)
      await page.getByRole("button", { name: "Collapse Home states", exact: true }).focus()
      await page.keyboard.press("Space")
      expect(await homeStates.isVisible()).toBe(false)
      expect(page.url()).toBe(allUrl)
      const expand = page.getByRole("button", { name: "Expand Home states", exact: true })
      expect(await expand.evaluate(node => node === document.activeElement)).toBe(true)
      expect(await expand.getAttribute("aria-expanded")).toBe("false")
      await page.keyboard.press("Enter")
      expect(await homeStates.isVisible()).toBe(true)
      await homeStates.getByRole("button", { name: "Empty", exact: true }).focus()
      await page.keyboard.press("Space")
      expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("state")).toBe("Empty")
      expect(await page.locator(".cal-grid").isVisible()).toBe(false)
      await page.reload()
      await homeStates.locator('[aria-current="true"]').waitFor()
      expect(await homeStates.locator('[aria-current="true"]').innerText()).toBe("Empty")

      // Expanding another part does not select it. Its child does select it.
      const beforeExpand = page.url()
      await page.getByRole("button", { name: "Expand Other states", exact: true }).click()
      expect(page.url()).toBe(beforeExpand)
      await otherStates.getByRole("button", { name: "Busy", exact: true }).click()
      expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("part")).toBe(other)
      expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("state")).toBe("Busy")
      await homeButton.click()
      expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("state")).toBe("*")

      const search = page.getByRole("searchbox", { name: "Filter parts" })
      await search.fill("wherever")
      expect(await page.locator(".cal-part").count()).toBe(4)
      expect(await page.locator(".cal-group").allTextContents()).toEqual(["Templates", "Organisms", "Molecules", "Atoms"])
      expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("part")).toBe(home)
      await search.fill("Home")
      expect(await page.locator(".cal-part").count()).toBe(1)
      await search.fill("")
      await page.reload()
      await page.locator(".cal-cell").first().waitFor()
      expect(await page.locator(".cal-cell").count()).toBe(3)

      // Reclassification on save and path-stable fallback.
      write("pages/Unknown.part.tsx", `export const layer = "page"\n${base}`)
      await page.waitForFunction(() => [...document.querySelectorAll(".cal-part")].findIndex(node => node.getAttribute("title") === "pages/Unknown.part.tsx") === 3)
      expect(await page.locator(".cal-group").allTextContents()).toEqual(["Pages", "Templates", "Organisms", "Molecules", "Atoms", "Unclassified"])

      // Container-size ladder: disclosure and selection remain reachable; the
      // list scrolls, and the preview keeps real device viewports at every size.
      mkdirSync("/tmp/caliper-navigation", { recursive: true })
      for (const size of [{ width: 1600, height: 1000 }, { width: 900, height: 700 }, { width: 420, height: 900 }, { width: 1280, height: 300 }, { width: 320, height: 480 }]) {
        await page.setViewportSize(size)
        await homeButton.scrollIntoViewIfNeeded()
        await homeButton.click()
        const toggle = page.getByRole("button", { name: "Collapse Home states", exact: true })
        await toggle.scrollIntoViewIfNeeded()
        const target = await toggle.boundingBox()
        expect(target).not.toBeNull()
        expect(target?.width).toBeGreaterThanOrEqual(44)
        expect(target?.height).toBeGreaterThanOrEqual(44)
        await toggle.click()
        expect(await homeStates.isVisible()).toBe(false)
        await page.getByRole("button", { name: "Expand Home states", exact: true }).click()
        expect(await homeStates.isVisible()).toBe(true)
        await homeStates.getByRole("button", { name: "Busy", exact: true }).click()
        expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("state")).toBe("Busy")
        await homeButton.click()
        expect(await page.locator(".cal-cell").count()).toBe(3)
        const screens = await page.locator(".cal-cell .cal-screen").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width))
        expect(new Set(screens).size).toBe(1)
        expect(screens[0]).toBeGreaterThan(0)
        expect(screens[0]).toBeLessThanOrEqual(72 * 4)
        for (const iframe of await page.locator(".cal-cell iframe").all()) {
          expect(await iframe.evaluate(node => /** @type {HTMLIFrameElement} */ (node).contentWindow?.innerWidth)).toBe(640)
        }
        const overflow = await page.evaluate(() => ({
          page: document.documentElement.scrollWidth - innerWidth,
          list: (document.querySelector(".cal-parts")?.scrollWidth ?? 0) - (document.querySelector(".cal-parts")?.clientWidth ?? 0),
        }))
        expect(overflow).toEqual({ page: 0, list: 0 })
        await page.screenshot({ path: `/tmp/caliper-navigation/${size.width}x${size.height}.png` })
      }
      expect(errors).toEqual([])
      await page.close()
    })
  } finally {
    await browser.close()
  }
}, 60_000)
