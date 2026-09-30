import { afterAll, beforeAll, expect, test } from "bun:test"
import { chromium } from "playwright-core"
import type { Browser, Page } from "playwright-core"
import { resolve } from "node:path"

// Real Chromium layout: anchors depend on hit testing, boxes and scrolling.
let browser: Browser
let page: Page
let server: ReturnType<typeof Bun.serve>
const html = `<!doctype html><style>body{margin:0} .row{display:flex;gap:8px;padding:8px} button{width:120px;height:40px} .tall{height:2000px}</style>
<div id="caliper-host">
  <div class="row"><button class="chip">Save</button><button class="chip">Cancel</button><button data-testid="go">Continue</button></div>
  <section class="card"><h2>Title</h2><p id="lede">Lede text</p></section>
  <div class="tall"></div><button class="deep">Deep</button>
</div>`

beforeAll(async () => {
  if (!process.env.CHROMIUM) throw new Error("Run with nix develop to supply CHROMIUM")
  const build = await Bun.build({ entrypoints: [resolve("src/takes/anchor.js")], target: "browser", format: "esm" })
  if (!build.success) throw new Error(build.logs.join("\n"))
  const bundle = await build.outputs[0]!.text()
  server = Bun.serve({ port: 0, fetch: request => new URL(request.url).pathname === "/anchor.js"
    ? new Response(bundle, { headers: { "content-type": "text/javascript" } })
    : new Response(html, { headers: { "content-type": "text/html" } }) })
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
  page = await browser.newPage({ viewport: { width: 640, height: 480 } })
  await page.goto(server.url.href)
  await page.evaluate(async () => { const path = "/anchor.js"; Object.assign(window, { anchor: await import(path) }) })
})
afterAll(async () => { await browser?.close(); server?.stop(true) })

type Api = typeof import("../src/takes/anchor.js")
const run = <T,>(body: string): Promise<T> => page.evaluate(`(() => { const { anchorAt, anchorIn, locateAnchor, drawMarks } = window.anchor; ${body} })()`) as Promise<T>

test("a click anchors to the element under it and finds it again", async () => {
  const result = await run<{ anchored: ReturnType<Api["anchorAt"]>; located: ReturnType<Api["locateAnchor"]> }>(`
    const anchored = anchorAt(document, { x: 180, y: 28 }, false)
    return { anchored, located: locateAnchor(document, anchored.anchor) }`)
  expect(result.anchored._tag).toBe("Anchored")
  if (result.anchored._tag !== "Anchored") return
  const { anchor } = result.anchored
  expect(anchor.element).toMatchObject({ tag: "button", classes: ["chip"], text: "Cancel", selector: "#caliper-host > div:nth-of-type(1) > button:nth-of-type(2)" })
  expect(anchor.rect).toEqual({ x: 180, y: 28, width: 0, height: 0 })
  expect(result.located).toEqual({ _tag: "Located", rect: anchor.rect })
})

test("unique ids and test attributes name the element; clicks outside the part attach to its host", async () => {
  const selectors = await run<string[]>(`return [anchorAt(document, { x: 300, y: 28 }, false), anchorAt(document, { x: 40, y: 110 }, false), anchorAt(document, { x: 630, y: 470 }, false)].map(result => result.anchor.element.selector)`)
  expect(selectors[0]).toBe('#caliper-host button[data-testid="go"]')
  expect(selectors[1]).toMatch(/^#caliper-host #lede$|^#caliper-host > section:nth-of-type\(1\)/)
  expect(selectors[2]).toBe("#caliper-host > div:nth-of-type(2)")
})

test("a sibling added above moves an unnamed mark; the text check turns it lost", async () => {
  const result = await run<{ moved: ReturnType<Api["locateAnchor"]>; restored: ReturnType<Api["locateAnchor"]>; hidden: ReturnType<Api["locateAnchor"]> }>(`
    const { anchor } = anchorAt(document, { x: 40, y: 28 }, false)
    const row = document.querySelector(".row")
    const extra = document.createElement("button"); extra.textContent = "New"; row.prepend(extra)
    const moved = locateAnchor(document, anchor)
    extra.remove()
    const restored = locateAnchor(document, anchor)
    row.firstElementChild.style.display = "none"
    const hidden = locateAnchor(document, anchor)
    row.firstElementChild.style.display = ""
    return { moved, restored, hidden }`)
  expect(result.moved).toMatchObject({ _tag: "Lost", reason: "The element's text changed." })
  expect(result.restored._tag).toBe("Located")
  expect(result.hidden._tag).toBe("Lost")
})

test("a moved element carries its mark; a removed one leaves it lost at its last place", async () => {
  const result = await run<{ before: ReturnType<Api["locateAnchor"]>; after: ReturnType<Api["locateAnchor"]>; gone: ReturnType<Api["locateAnchor"]> }>(`
    const { anchor } = anchorAt(document, { x: 20, y: 20 }, true)
    const before = locateAnchor(document, anchor)
    document.querySelector(".row").style.paddingTop = "58px"
    const after = locateAnchor(document, anchor)
    document.querySelector(".row").style.paddingTop = ""
    const clone = JSON.parse(JSON.stringify(anchor)); clone.element.selector = "#caliper-host > nav:nth-of-type(4)"
    return { before, after, gone: locateAnchor(document, clone) }`)
  expect(result.before).toMatchObject({ _tag: "Located", rect: { x: 20, y: 20 } })
  expect(result.after).toMatchObject({ _tag: "Located", rect: { x: 20, y: 70 } })
  expect(result.gone).toEqual({ _tag: "Lost", reason: "Element not found.", rect: { x: 20, y: 20, width: 0, height: 0 } })
})

test("a drag anchors to the smallest element that holds it and lists the elements inside", async () => {
  const anchored = await run<ReturnType<Api["anchorIn"]>>(`return anchorIn(document, { x: 2, y: 2, width: 270, height: 50 }, false)`)
  if (anchored._tag !== "Anchored") throw new Error("not anchored")
  expect(anchored.anchor.kind).toBe("Region")
  expect(anchored.anchor.element.selector).toBe("#caliper-host > div:nth-of-type(1)")
  expect(anchored.anchor.elements.map(element => element.text)).toEqual(["Save", "Cancel"])
})

test("anchors use document coordinates, so a scrolled frame finds its mark", async () => {
  const result = await run<{ anchor: ReturnType<Api["anchorAt"]>; located: ReturnType<Api["locateAnchor"]>; top: ReturnType<Api["locateAnchor"]> }>(`
    const deep = document.querySelector(".deep"); deep.scrollIntoView()
    const box = deep.getBoundingClientRect()
    const anchored = anchorAt(document, { x: box.left + 5, y: box.top + 5 }, false)
    const located = locateAnchor(document, anchored.anchor)
    scrollTo(0, 0)
    return { anchor: anchored, located, top: locateAnchor(document, anchored.anchor) }`)
  if (result.anchor._tag !== "Anchored") throw new Error("not anchored")
  expect(result.anchor.anchor.element.tag).toBe("button")
  expect(result.anchor.anchor.rect.y).toBeGreaterThan(2000)
  expect(result.top).toEqual(result.located)
})

test("drawMarks adds one layer that does not take input", async () => {
  const drawn = await run<{ layers: number; events: string }>(`
    drawMarks(document, [{ letter: "A", kind: "Point", rect: { x: 10, y: 10, width: 0, height: 0 } }, { letter: "AB", kind: "Region", rect: { x: 20, y: 60, width: 100, height: 40 } }])
    const layer = document.querySelector("[data-caliper-marks]")
    return { layers: document.querySelectorAll("[data-caliper-marks]").length, events: layer.style.pointerEvents, text: layer.textContent }`)
  expect(drawn).toMatchObject({ layers: 1, events: "none", text: "AAB" })
})
