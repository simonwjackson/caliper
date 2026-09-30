// @ts-check
import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { createServer } from "node:http"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { chromium } from "playwright-core"
import { cal, deferLayout, reveal } from "../scripts/verify-helpers.mjs"

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64")
const interactionPng = Buffer.concat([png, Buffer.from("interaction evidence")])
/** @param {Buffer} bytes */
const digest = bytes => createHash("sha256").update(bytes).digest("hex")

test.skipIf(!process.env.CHROMIUM)("reference Chrome and real checks controller retain Stop, named outcomes, provenance and saved images", async () => {
  const build = await Bun.build({ entrypoints: [resolve("test/chrome-checks-browser-entry.tsx")], target: "browser" })
  if (!build.success) throw new Error(build.logs.join("\n"))
  const bundle = await build.outputs[0].text()
  const id = crypto.randomUUID(), request = { part: "Button.part.tsx", state: "default" }
  /** @type {import('../src/checks/contract.js').ChecksView} */
  let view = { _tag: "Running", id, request, total: 2, startedAt: "now", progress: { phase: "Authored", completed: 1, total: 2 } }
  /** @type {import('node:http').ServerResponse[]} */
  const streams = []
  /** @type {object[]} */
  const cancelRequests = []
  /** @type {string[]} */
  const imageRequests = []
  let approved = 0
  const publish = () => { for (const response of streams) response.write(`event: checks\ndata: ${JSON.stringify(view)}\n\n`) }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost")
    const path = url.pathname.replace(/^\/__caliper/, "")
    if (path === "/checks") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(view)); return }
    if (path === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" })
      streams.push(res)
      res.write(": connected\n\n")
      res.on("close", () => { const index = streams.indexOf(res); if (index !== -1) streams.splice(index, 1) })
      return
    }
    if (path === "/checks/cancel" && req.method === "POST") {
      let body = ""
      for await (const chunk of req) body += chunk
      cancelRequests.push(JSON.parse(body))
      view = { _tag: "Cancelled", id, request, reason: "Stopped by user." }
      publish()
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify(view)); return
    }
    if (path === "/checks/approve") { approved++; res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "Take images cannot become baselines" })); return }
    if (path === "/checks/image") {
      imageRequests.push(url.search)
      res.setHeader("content-type", "image/png"); res.end(url.searchParams.get("kind") === "authored" ? interactionPng : png); return
    }
    if (path === "/checks/report" && view._tag === "Ready") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(view.report)); return }
    if (path === "/fixture.js") { res.setHeader("content-type", "text/javascript"); res.end(bundle); return }
    if (path !== "/") { res.writeHead(404); res.end(); return }
    res.setHeader("content-type", "text/html")
    res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="fixture.js"></script></body></html>')
  })
  await new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(undefined)))
  const address = /** @type {import('node:net').AddressInfo} */ (server.address())
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } })
  page.setDefaultTimeout(5000)
  /** @type {string[]} */
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  const output = "/tmp/caliper-authored-checks-ui"
  mkdirSync(output, { recursive: true })
  const shapes = /** @type {Array<[string, number, number]>} */ ([["wide", 1800, 1000], ["narrow-tall", 360, 900], ["wide-short", 1400, 300], ["small", 320, 480]])
  try {
    await page.goto(`http://127.0.0.1:${address.port}/__caliper/`)
    const open = async () => { await page.locator(`${cal.tool}[data-tool="checks"]`).click(); await dialog.waitFor() }
    const dialog = page.getByRole("dialog", { name: "Checks", exact: true })
    await open()
    await dialog.getByText("Authored: 1 of 2.", { exact: true }).waitFor()
    for (const [name, width, height] of shapes) {
      await page.setViewportSize({ width, height })
      expect(await dialog.locator(cal.checkStop).isEnabled()).toBe(true)
      expect(await dialog.locator(cal.checksClose).isEnabled()).toBe(true)
      await page.screenshot({ path: `${output}/running-${name}.png` })
    }
    deferLayout(["Checks control geometry and horizontal overflow at all four shapes", "Checks follows an embedded 360 × 480 container; focus restoration"])
    await dialog.locator(cal.checksClose).click()
    expect(cancelRequests).toEqual([])
    expect(view._tag).toBe("Running")
    await open()
    await dialog.locator(cal.checkStop).click()
    await dialog.getByRole("alert").filter({ hasText: "Checks stopped. Stopped by user." }).waitFor()
    expect(cancelRequests).toEqual([{ id }])
    expect(await dialog.getByRole("button", { name: "Check selected preview", exact: true }).isEnabled()).toBe(true)

    view = { _tag: "Ready", id: crypto.randomUUID(), request: { ...request, take: "7" }, stale: false, approved: [], report: {
      version: 2, project: "app", environment: "test", createdAt: new Date().toISOString(), coverage: "Named scenarios only",
      run: { id: "authored-run", termination: "Cancelled", source: { epoch: "server", generation: 4, fingerprint: "a".repeat(64) }, stale: false },
      results: [{ part: request.part, state: request.state, take: "7", device: "rg353m", frame: "Rendered", viewport: { width: 640, height: 480 }, png: "first.png", repeatPng: "repeat.png", sha256: digest(png), repeatSha256: digest(png),
        checks: [{ name: "render", status: "Passed", detail: "Rendered" }, { name: "browser", status: "Passed", detail: "No errors" }, { name: "determinism", status: "Passed", detail: "Matching images" }],
        authored: { status: "Failed", reason: "Assertion", provenance: { kind: "Take", take: "7", files: ["Button.part.tsx", "retry-helper.ts"], changedDeclarations: ["edited: retry loads the library"] },
          checks: [{ name: "retry loads the library", source: { file: "Button.part.tsx", line: 9 }, status: "Failed", reason: "Assertion", detail: "Expected Library to be visible", durationMs: 25, errors: [], image: "interaction.png", imageSha256: digest(interactionPng) },
            { name: "opens a portal", source: { file: "Button.part.tsx", line: 17 }, status: "NotRun", reason: "Cancelled", detail: "Stopped before execution", durationMs: 0, errors: [], evidenceError: "No image was captured" }],
        },
      }],
    } }
    publish()
    await (await reveal(page, dialog.getByText(/Run ended: Cancelled\. These are partial observations, not a completed pass\./))).waitFor({ state: "visible" })
    const row = dialog.locator(`${cal.checkRow}[data-index="0"]`)
    await row.locator(":scope > summary").click()
    await (await reveal(page, row.getByText("Expected Library to be visible", { exact: false }))).waitFor({ state: "visible" })
    await row.getByText(/Passing does not prove preservation of the original contract/).waitFor()
    expect(await row.innerText()).toContain("retry-helper.ts")
    expect(await row.innerText()).toContain("edited: retry loads the library")
    const portal = row.locator(cal.finding).filter({ hasText: "opens a portal" })
    await portal.locator(":scope > summary").click()
    await portal.getByText(/Interaction image unavailable: No image was captured/).waitFor()
    expect(await portal.locator(":scope > summary").innerText()).toContain("NotRun")
    expect(await row.locator(":scope > summary").innerText()).toContain("1 failed")
    expect(await row.locator(cal.imageReviewed).isDisabled()).toBe(true)
    expect(await row.locator(cal.approveImage).isDisabled()).toBe(true)
    await page.waitForFunction(selector => {
      const images = [...document.querySelectorAll(`${selector} img`)]
      return images.length === 3 && images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)
    }, `${cal.checkRow}[data-index="0"]`)
    expect(imageRequests.some(query => query.includes("kind=first"))).toBe(true)
    expect(imageRequests.some(query => query.includes("kind=repeat"))).toBe(true)
    expect(imageRequests.some(query => query.includes("kind=authored&check=0"))).toBe(true)
    const shot = row.getByRole("img", { name: /retry loads the library: interaction evidence/ })
    expect(await shot.count()).toBe(1)
    expect(await row.getByRole("link").filter({ has: page.getByRole("img", { name: /retry loads the library: interaction evidence/ }) }).getAttribute("href")).toContain("kind=authored&check=0")
    expect(approved).toBe(0)
    for (const [name, width, height] of shapes) {
      await page.setViewportSize({ width, height })
      expect(await dialog.locator(cal.checksClose).isEnabled()).toBe(true)
      expect(await dialog.getByRole("button", { name: "Check selected preview", exact: true }).isEnabled()).toBe(true)
      expect(await row.locator(cal.approveImage).isDisabled()).toBe(true)
      await page.screenshot({ path: `${output}/${name}.png` })
    }
    expect(errors).toEqual([])
    writeFileSync(`${output}/verification.json`, JSON.stringify({ cancelRequests, imageRequests, approved, pageErrors: errors, layout: "Deferred: unstyled reference" }, null, 2))
  } catch (error) {
    await page.screenshot({ path: `${output}/failure.png` }).catch(() => {})
    writeFileSync(`${output}/failure.json`, JSON.stringify({ error: String(error), errors, cancelRequests, imageRequests, streams: streams.length, body: await page.locator("body").innerText() }, null, 2))
    throw error
  } finally {
    await browser.close()
    for (const response of streams) response.end()
    server.closeAllConnections()
    await new Promise(resolve => server.close(() => resolve(undefined)))
  }
}, 30_000)
