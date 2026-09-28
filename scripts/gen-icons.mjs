#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 --command node

/**
 * Generate Caliper's favicon, install, and home-screen icons from the
 * chrome's own colors and mark.
 *
 * The mark is a graduated arc: a capital C spelled as ruler graduations, with
 * the reading tick lit in the launcher accent. It is defined once, as a pure
 * function of the drawing box, and rendered across the whole size ladder. The
 * variants below differ only in how much room the mark is given, because each
 * target crops differently — a maskable icon is a different container, not a
 * smaller icon.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"

const root = fileURLToPath(new URL("..", import.meta.url))
const outDir = join(root, "src", "pwa")
mkdirSync(outDir, { recursive: true })

const css = readFileSync(join(root, "src", "client", "chrome.css"), "utf8")
/** @param {string} name */
const token = name => new RegExp(`--cal-${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim()
const pageColor = token("bg")
const ink = token("ink")
const accent = token("accent")
if (!pageColor || !ink || !accent) throw new Error("The chrome's PWA color tokens are missing.")
const manifestFile = join(outDir, "manifest.webmanifest")
const manifest = JSON.parse(readFileSync(manifestFile, "utf8"))
manifest.background_color = pageColor
manifest.theme_color = pageColor
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`)

/** The mark, drawn in a 512-unit box. Every number that shapes it lives here. */
const BOX = 512
const MARK = {
  ticks: 9, // odd, so one tick sits at the reading position
  span: 250, // degrees of arc covered; the remainder is the C's mouth
  radius: 188, // outer end of every tick
  tickLength: 92,
  minorRatio: 0.65, // every other tick is shorter, giving the scale its rhythm
  strokeWidth: 44,
  centerX: 272, // pushed right of centre so the C's mouth does not unbalance it
  centerY: 256,
}

/** Half-width of the drawn mark, measured from the centre of the box. */
const CONTENT_RADIUS =
  MARK.radius + MARK.strokeWidth / 2 + Math.abs(MARK.centerX - BOX / 2)

/**
 * How much of the box each target actually shows.
 *  - full: the whole square is visible (favicon, manifest "any", Apple).
 *  - maskable: Android guarantees only a centred circle of 80% diameter, so
 *    the mark is scaled to sit inside it with margin to spare.
 */
const SAFE_CIRCLE_RADIUS = BOX * 0.4
const VARIANT_SCALE = {
  full: 1,
  maskable: (SAFE_CIRCLE_RADIUS * 0.92) / CONTENT_RADIUS,
}

/** @param {number} degrees */
const radians = degrees => (degrees * Math.PI) / 180

/** Tick geometry as data, so the drawing step has no decisions left to make. */
function markTicks() {
  const first = 180 - MARK.span / 2
  const step = MARK.span / (MARK.ticks - 1)
  const reading = (MARK.ticks - 1) / 2

  return Array.from({ length: MARK.ticks }, (_, index) => {
    const angle = first + index * step
    const isReading = index === reading
    const isMinor = !isReading && index % 2 !== 0
    const length = isMinor ? MARK.tickLength * MARK.minorRatio : MARK.tickLength
    const inner = MARK.radius - length

    return {
      x1: MARK.centerX + inner * Math.cos(radians(angle)),
      y1: MARK.centerY + inner * Math.sin(radians(angle)),
      x2: MARK.centerX + MARK.radius * Math.cos(radians(angle)),
      y2: MARK.centerY + MARK.radius * Math.sin(radians(angle)),
      color: isReading ? accent : ink,
    }
  })
}

/** @param {{ variant?: "full" | "maskable", background?: string }} [options] */
function markSvg({ variant = "full", background = pageColor } = {}) {
  const scale = VARIANT_SCALE[variant]
  const offset = (BOX / 2) * (1 - scale)
  const lines = markTicks()
    .map(
      tick =>
        `<line x1="${tick.x1.toFixed(2)}" y1="${tick.y1.toFixed(2)}"` +
        ` x2="${tick.x2.toFixed(2)}" y2="${tick.y2.toFixed(2)}"` +
        ` stroke="${tick.color}" stroke-width="${MARK.strokeWidth}" stroke-linecap="round"/>`,
    )
    .join("")

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOX} ${BOX}" width="${BOX}" height="${BOX}">` +
    (background ? `<rect width="${BOX}" height="${BOX}" fill="${background}"/>` : "") +
    `<g transform="translate(${offset.toFixed(2)} ${offset.toFixed(2)}) scale(${scale.toFixed(4)})">${lines}</g>` +
    `</svg>`
  )
}

/**
 * The full icon set.
 *  - favicon.svg scales to any tab size and needs no raster.
 *  - favicon 16/32 cover browsers that ignore SVG favicons.
 *  - 192 and 512 are the manifest sizes install prompts require.
 *  - maskable 192/512 survive Android's adaptive-icon crop.
 *  - apple-touch-icon is iOS's home-screen source; iOS ignores "maskable".
 */
/** @type {{ file: string, size: number, variant: "full" | "maskable" }[]} */
const targets = [
  { file: "favicon-16.png", size: 16, variant: "full" },
  { file: "favicon-32.png", size: 32, variant: "full" },
  { file: "icon-192.png", size: 192, variant: "full" },
  { file: "icon-512.png", size: 512, variant: "full" },
  { file: "icon-maskable-192.png", size: 192, variant: "maskable" },
  { file: "icon-maskable-512.png", size: 512, variant: "maskable" },
  { file: "apple-touch-icon.png", size: 180, variant: "full" },
]

writeFileSync(join(outDir, "favicon.svg"), `${markSvg()}\n`)
console.log("wrote src/pwa/favicon.svg")

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? chromium.executablePath(),
  headless: true,
  args: ["--no-sandbox"],
})
const page = await browser.newPage({ viewport: { width: BOX, height: BOX } })

for (const target of targets) {
  const svg = markSvg({ variant: target.variant })
  await page.setViewportSize({ width: target.size, height: target.size })
  await page.setContent(
    `<!doctype html><html><body style="margin:0">` +
      `<div id="icon" style="width:${target.size}px;height:${target.size}px">` +
      svg.replace(`width="${BOX}" height="${BOX}"`, `width="100%" height="100%"`) +
      `</div></body></html>`,
  )
  writeFileSync(join(outDir, target.file), await page.locator("#icon").screenshot())
  console.log(`wrote src/pwa/${target.file}`)
}

await browser.close()
