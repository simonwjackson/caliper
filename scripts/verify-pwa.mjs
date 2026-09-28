#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 --command node
// @ts-check
/** Check the installed chrome on a real product Vite server, with and without a Vite base. */
import assert from "node:assert/strict"
import { chromium } from "playwright-core"
import { withProject, manifest as projectManifest } from "../test/project-server.js"

const files = {
  "package.json": projectManifest(),
  "index.html": '<!doctype html><title>Product</title><div id="product">Product page</div>',
  "public/manifest.webmanifest": '{"name":"Product"}',
  "public/icon-192.png": "product-icon",
  "src/index.ts": 'import "./app.css"\nexport { mount } from "./mount"\n',
  "src/mount.tsx": 'import { createRoot } from "react-dom/client"\nexport const mount = (el: HTMLElement) => createRoot(el).render(<div className="shell" />)\n',
  "src/app.css": ".shell { width: 100% }\n",
  "src/Chip.part.tsx": "export default function Chip() { return <span>Chip</span> }\n",
}

const executablePath = process.env.CHROMIUM ?? chromium.executablePath()
const browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
try {
  for (const base of ["/", "/preview/"]) {
    await withProject({ files, base }, async ({ url }) => {
      const prefix = `${base}__caliper/`
      const address = new URL(prefix.slice(1), new URL(url).origin + "/").href
      const page = await browser.newPage({ viewport: { width: 412, height: 620 }, isMobile: true, hasTouch: true })
      /** @type {string[]} */
      const errors = []
      page.on("pageerror", error => errors.push(error.message))
      try {
        const response = await page.goto(address, { waitUntil: "load" })
        assert.equal(response?.status(), 200)
        await page.locator(".cal-bar").waitFor({ timeout: 20_000 })
        const meta = await page.evaluate(() => ({
          viewport: document.querySelector('meta[name="viewport"]')?.getAttribute("content"),
          manifest: document.querySelector('link[rel="manifest"]')?.getAttribute("href"),
          appleIcon: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href"),
          theme: document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
          mobile: document.querySelector('meta[name="mobile-web-app-capable"]')?.getAttribute("content"),
          apple: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.getAttribute("content"),
          appleStyle: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute("content"),
          overscroll: getComputedStyle(document.body).overscrollBehavior,
        }))
        assert.deepEqual(meta, {
          viewport: "width=device-width, initial-scale=1, viewport-fit=cover",
          manifest: `${prefix}manifest.webmanifest`, appleIcon: `${prefix}apple-touch-icon.png`,
          theme: "#16171a", mobile: "yes", apple: "yes", appleStyle: "black-translucent", overscroll: "none",
        })
        const manifestResponse = await fetch(new URL(`${prefix}manifest.webmanifest`, new URL(url).origin))
        assert.equal(manifestResponse.headers.get("content-type"), "application/manifest+json")
        const manifest = await manifestResponse.json()
        assert.equal(manifest.display, "fullscreen")
        assert.deepEqual(manifest.display_override, ["fullscreen", "standalone", "minimal-ui"])
        assert.equal(new URL(manifest.start_url, manifestResponse.url).href, address)
        assert.equal(new URL(manifest.scope, manifestResponse.url).href, address)
        for (const icon of manifest.icons) {
          assert.equal(icon.purpose === "maskable" || icon.purpose === "any", true)
          const src = new URL(icon.src, manifestResponse.url)
          assert(src.href.startsWith(address))
          const size = await page.evaluate(async imageUrl => {
            const image = new Image()
            image.src = imageUrl
            await image.decode()
            return `${image.naturalWidth}x${image.naturalHeight}`
          }, src.href)
          assert.equal(size, icon.sizes)
        }
        for (const [name, size] of [["favicon-16.png", "16x16"], ["favicon-32.png", "32x32"], ["apple-touch-icon.png", "180x180"]]) {
          const actual = await page.evaluate(async imageUrl => {
            const image = new Image()
            image.src = imageUrl
            await image.decode()
            return `${image.naturalWidth}x${image.naturalHeight}`
          }, `${prefix}${name}`)
          assert.equal(actual, size)
        }
        const cdp = await page.context().newCDPSession(page)
        const appManifest = await cdp.send("Page.getAppManifest")
        const installability = await cdp.send("Page.getInstallabilityErrors")
        assert.deepEqual(appManifest.errors, [])
        assert.deepEqual(installability.installabilityErrors.filter(error => error.errorId !== "in-incognito"), [])
        for (const [width, height] of [[412, 620], [320, 480]]) {
          await page.setViewportSize({ width, height })
          const layout = await page.evaluate(() => {
            document.documentElement.style.setProperty("--cal-safe-top", "32px")
            document.documentElement.style.setProperty("--cal-safe-right", "12px")
            document.documentElement.style.setProperty("--cal-safe-bottom", "20px")
            document.documentElement.style.setProperty("--cal-safe-left", "8px")
            return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
              const root = /** @type {HTMLElement} */ (document.querySelector(".cal-root")).getBoundingClientRect()
              const bar = /** @type {HTMLElement} */ (document.querySelector(".cal-bar")).getBoundingClientRect()
              resolve({ root: root.toJSON(), bar: bar.toJSON(), padding: getComputedStyle(document.body).padding })
            })))
          })
          assert.equal(layout.padding, "32px 12px 20px 8px")
          assert(layout.root.left >= 8 && layout.root.top >= 32)
          assert(layout.bar.top >= 32 && layout.bar.right <= width - 12)
        }
        assert.equal((await (await fetch(new URL(`${base}manifest.webmanifest`, new URL(url).origin))).json()).name, "Product")
        assert.equal(await (await fetch(new URL(`${base}icon-192.png`, new URL(url).origin))).text(), "product-icon")
        assert.deepEqual(errors, [])
        process.stdout.write(`${base}: manifest, assets, installability, product isolation, safe-area layout passed\n`)
      } finally {
        await page.close()
      }
    })
  }
} finally {
  await browser.close()
}
