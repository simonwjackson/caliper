#!/usr/bin/env -S nix develop -c node
// @ts-check
/**
 * Render every gallery fixture at the mockup's three sizes, light and dark,
 * to scripts/ui/out/<fixture>[-<act>]-<size>-<scheme>.png. For a fixture that
 * answers a mockup state, also write scripts/ui/out/compare/<same name>.png:
 * the mockup render on the left, this build on the right, at the same size.
 *
 *   scripts/ui/shoot.mjs               # every shot
 *   scripts/ui/shoot.mjs takes log     # some fixtures
 */
import { chromium } from "playwright-core"
import { mkdirSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { SIZES, serveGallery } from "./lib.mjs"
import { SHOTS } from "./fixtures.mjs"

const out = join("scripts", "ui", "out")
const compare = join(out, "compare")
mkdirSync(compare, { recursive: true })
const only = process.argv.slice(2)
const shots = only.length ? SHOTS.filter(shot => only.includes(shot.fixture)) : SHOTS
const gallery = await serveGallery()
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM })
/** @type {string[]} */
const written = []
/** @type {string[]} */
const errors = []
try {
  for (const shot of shots) {
    for (const size of SIZES) {
      if (shot.act === "drawer" && size.name !== "phone") continue
      for (const scheme of /** @type {const} */ (["dark", "light"])) {
        const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale, colorScheme: scheme })
        const page = await context.newPage()
        page.on("pageerror", error => errors.push(`${shot.fixture} ${size.name} ${scheme}: ${error.message}`))
        page.on("console", message => { if (message.type() === "error") errors.push(`${shot.fixture} ${size.name} ${scheme}: ${message.text()}`) })
        await page.goto(`${gallery.origin}/?fixture=${shot.fixture}`)
        await page.waitForSelector('[data-cal="chrome"]')
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(250)
        if (shot.act === "menu" || shot.act === "models") await page.getByRole("button", { name: "New take options" }).click()
        if (shot.act === "models") { await page.locator('[data-cal="agent-status"]').click(); await page.locator('[data-cal="agent-model-filter"]').fill("qwen") }
        if (shot.act === "drawer") await page.locator('[data-cal="parts-toggle"]').click()
        await page.waitForTimeout(120)
        const name = `${shot.fixture}${shot.act ? `-${shot.act}` : ""}-${size.name}-${scheme}`
        const file = join(out, `${name}.png`)
        await page.screenshot({ path: file })
        written.push(file)
        await context.close()
        const mockup = shot.mockup ? join("docs", "design", "mockups", "out", `b-${shot.mockup}-${size.name}-${scheme}.png`) : null
        if (mockup && existsSync(mockup)) {
          const sheet = await browser.newContext({ viewport: { width: size.width * 2 + 24, height: size.height + 28 }, deviceScaleFactor: size.scale, colorScheme: scheme })
          const view = await sheet.newPage()
          const data = (/** @type {string} */ path) => `data:image/png;base64,${readFileSync(path).toString("base64")}`
          await view.setContent(`<body style="margin:0;background:#777;font:12px system-ui;color:#fff"><div style="display:grid;grid-template-columns:${size.width}px ${size.width}px;gap:24px">
            <div>mockup: ${mockup}</div><div>build: ${file}</div>
            <img src="${data(mockup)}" style="width:${size.width}px;height:${size.height}px"><img src="${data(file)}" style="width:${size.width}px;height:${size.height}px"></div></body>`)
          const sheetFile = join(compare, `${name}.png`)
          await view.screenshot({ path: sheetFile })
          written.push(sheetFile)
          await sheet.close()
        }
      }
    }
  }
} finally {
  await browser.close()
  await gallery.close()
}
console.log(`Wrote ${written.length} images to ${out}.`)
if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1 }
