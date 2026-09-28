// @ts-check
import { expect, test } from "bun:test"
import { createServer } from "node:http"
import { mkdirSync, readFileSync } from "node:fs"
import { chromium } from "playwright-core"

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64")

test.skipIf(!process.env.CHROMIUM)("Checks UI exposes Stop, named outcomes and provenance across container shapes", async () => {
  const id = crypto.randomUUID(), request = { part: "Button.part.tsx", state: "default" }
  /** @type {import('../src/checks/contract.js').ChecksView} */
  let view = { _tag: "Running", id, request, total: 2, startedAt: "now", progress: { phase: "Authored", completed: 1, total: 2 } }
  let stopped = 0
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost")
    if (url.pathname === "/checks") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(view)); return }
    if (url.pathname === "/checks/cancel" && req.method === "POST") {
      stopped++
      view = { _tag: "Cancelled", id, request, reason: "Stopped by user." }
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify(view)); return
    }
    if (url.pathname === "/checks/image") { res.setHeader("content-type", "image/png"); res.end(png); return }
    const file = url.pathname.slice(1)
    if (["checks-panel.js", "checks-view.js", "dom.js", "chrome.css", "checks.css"].includes(file)) {
      res.setHeader("content-type", file.endsWith(".css") ? "text/css" : "text/javascript")
      res.end(readFileSync(new URL(`../src/client/${file}`, import.meta.url))); return
    }
    res.setHeader("content-type", "text/html")
    res.end(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/chrome.css"></head><body>
      <div id="host" style="width:100%;height:100%"><button class="cal-checks-toggle">Checks</button></div>
      <script type="module">
        import { createChecksPanel } from '/checks-panel.js';
        const panel = createChecksPanel({ container: document.querySelector('#host'), target: () => ({ part: 'Button.part.tsx', state: 'default', label: 'Retry scenario' }), changed: () => {} });
        document.querySelector('button').addEventListener('click', panel.open);
        window.addEventListener('checks', event => panel.receive(event.detail));
      </script></body></html>`)
  })
  await new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(undefined)))
  const address = /** @type {import('node:net').AddressInfo} */ (server.address())
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } })
  /** @type {string[]} */
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  try {
    await page.goto(`http://127.0.0.1:${address.port}/`)
    await page.getByRole("button", { name: "Checks", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Checks", exact: true })
    await dialog.getByText("Authored: 1 of 2.", { exact: true }).waitFor()
    const shapes = /** @type {Array<[string, number, number]>} */ ([["wide", 1800, 1000], ["narrow-tall", 360, 900], ["wide-short", 1400, 300], ["small", 320, 480]])
    for (const [_name, width, height] of shapes) {
      await page.setViewportSize({ width, height })
      for (const control of [dialog.getByRole("button", { name: "Stop checks", exact: true }), dialog.getByRole("button", { name: "Close checks" })]) {
        await control.scrollIntoViewIfNeeded()
        const box = await control.boundingBox()
        expect(box).not.toBeNull()
        expect(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1).toBe(true)
      }
    }
    await dialog.getByRole("button", { name: "Close checks" }).click()
    expect(stopped).toBe(0)
    await page.getByRole("button", { name: "Checks", exact: true }).click()
    await dialog.getByRole("button", { name: "Stop checks", exact: true }).click()
    await dialog.getByRole("heading", { name: "Checks stopped" }).waitFor()
    expect(stopped).toBe(1)
    expect(await dialog.getByRole("button", { name: "Check selected preview", exact: true }).isEnabled()).toBe(true)

    view = { _tag: "Ready", id: crypto.randomUUID(), request: { ...request, take: "7" }, stale: false, approved: [], report: {
      version: 2, project: "app", environment: "test", createdAt: new Date().toISOString(), coverage: "Named scenarios only",
      run: { id: "authored-run", termination: "Cancelled", source: { epoch: "server", generation: 4, fingerprint: "a".repeat(64) }, stale: false },
      results: [{ part: request.part, state: request.state, take: "7", device: "rg353m", frame: "Rendered", viewport: { width: 640, height: 480 }, png: "first.png", repeatPng: "repeat.png", sha256: "a".repeat(64), repeatSha256: "a".repeat(64),
        checks: [{ name: "render", status: "Passed", detail: "Rendered" }, { name: "browser", status: "Passed", detail: "No errors" }, { name: "determinism", status: "Passed", detail: "Matching images" }],
        authored: { status: "Failed", reason: "Assertion", provenance: { kind: "Take", take: "7", files: ["Button.part.tsx", "retry-helper.ts"], changedDeclarations: ["edited: retry loads the library"] },
          checks: [{ name: "retry loads the library", source: { file: "Button.part.tsx", line: 9 }, status: "Failed", reason: "Assertion", detail: "Expected Library to be visible", durationMs: 25, errors: [], image: "interaction.png", imageSha256: "b".repeat(64) },
            { name: "opens a portal", source: { file: "Button.part.tsx", line: 17 }, status: "NotRun", reason: "Cancelled", detail: "Stopped before execution", durationMs: 0, errors: [], evidenceError: "No image was captured" }],
        },
      }],
    } }
    await page.evaluate(value => window.dispatchEvent(new CustomEvent("checks", { detail: value })), view)
    await dialog.getByText("Run ended: Cancelled. These are partial observations, not a completed pass.", { exact: true }).waitFor()
    await dialog.locator(".cal-check-result > summary").click()
    await dialog.getByText("Expected Library to be visible", { exact: false }).waitFor()
    await dialog.getByText("Expectation provenance", { exact: true }).click()
    await dialog.getByText(/Passing does not prove preservation of the original contract/).waitFor()
    await dialog.getByText("opens a portal", { exact: false }).first().click()
    await dialog.getByText(/Interaction image unavailable: No image was captured/).waitFor()
    expect(await dialog.locator(".cal-check-result > summary").innerText()).toContain("1 failed")
    expect(await dialog.getByRole("checkbox").count()).toBe(0)
    expect(await dialog.getByRole("button", { name: "Approve this image", exact: true }).count()).toBe(0)
    expect(await dialog.getByText("Interaction evidence. Not a baseline image.", { exact: true }).count()).toBe(1)
    const output = "/tmp/caliper-authored-checks-ui"
    mkdirSync(output, { recursive: true })
    for (const [name, width, height] of shapes) {
      await page.setViewportSize({ width, height })
      for (const control of [dialog.getByRole("button", { name: "Close checks" }), dialog.getByRole("button", { name: "Check selected preview", exact: true }), dialog.getByText("Expectation provenance", { exact: true }), dialog.locator(".cal-check-finding > summary").filter({ hasText: "retry loads the library" })]) {
        await control.scrollIntoViewIfNeeded()
        const box = await control.boundingBox()
        expect(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1).toBe(true)
      }
      expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
      await dialog.getByText("Authored interactions", { exact: true }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${output}/${name}.png` })
    }
    await page.setViewportSize({ width: 1800, height: 1000 })
    await page.locator("#host").evaluate(node => { node.style.width = "360px"; node.style.height = "480px" })
    await page.waitForFunction(() => (document.querySelector(".cal-checks-dialog")?.getBoundingClientRect().right ?? 9999) <= 360)
    await dialog.getByRole("button", { name: "Close checks" }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${output}/embedded.png` })
    expect(errors).toEqual([])
  } finally {
    await browser.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(() => resolve(undefined)))
  }
}, 30_000)
