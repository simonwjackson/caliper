#!/usr/bin/env -S nix develop -c node
// @ts-check
/**
 * One gallery fixture at one size, for a quick look while designing.
 *
 *   scripts/ui/shot.mjs <fixture> <width>x<height> [scale] [dark|light] [out.png]
 *
 * It prints the board's plan (columns and rows) when the fixture has a board.
 */
import { chromium } from "playwright-core"
import { serveGallery } from "./lib.mjs"

const [fixture = "workspaceBoard", dims = "1280x300", scale = "1", scheme = "dark", out = `/tmp/${fixture}-${dims}.png`] = process.argv.slice(2)
const [width, height] = dims.split("x").map(Number)
const gallery = await serveGallery()
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM })
try {
  const context = await browser.newContext({ viewport: { width: width ?? 1280, height: height ?? 300 }, deviceScaleFactor: Number(scale), colorScheme: scheme === "light" ? "light" : "dark" })
  const page = await context.newPage()
  await page.goto(`${gallery.origin}/?fixture=${fixture}`)
  await page.waitForSelector('[data-cal="chrome"]')
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
  const plan = await page.evaluate(() => {
    const board = document.querySelector('[data-cal="board"]')
    return board ? `${board.getAttribute("data-columns")}/${board.getAttribute("data-rows")} body ${document.querySelector(".ws-board__body")?.clientWidth}x${document.querySelector(".ws-board__body")?.clientHeight}` : "no board"
  })
  await page.screenshot({ path: out })
  console.log(`${out} ${plan}`)
} finally {
  await browser.close()
  await gallery.close()
}
