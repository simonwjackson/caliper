#!/usr/bin/env -S nix shell nixpkgs#nodejs --command node
/**
 * Exercise images attached to prompts with real React, Vite and Chromium, in
 * a temporary project. The agent talks to a small local model server that
 * records each request and answers "Done.", so the check sees exactly what
 * the model would receive. Pass a React project's node_modules:
 *
 *   CHROMIUM=/path/to/chromium node scripts/verify-attachments.mjs --modules /path/to/node_modules
 *
 * It attaches by file picker and by drop, refuses a wrong type, removes one,
 * starts a take and a follow-up, checks the model requests and the log, and
 * takes screenshots of the composer at four window sizes. Screenshots go to
 * /tmp/caliper-verify-attachments.
 */
import assert from "node:assert/strict"
import { createServer as createHttpServer } from "node:http"
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { deflateSync } from "node:zlib"
import { createServer } from "vite"
import { chromium } from "playwright-core"
import { caliper } from "../src/plugin.js"
import { cal, deferLayout, reveal, waitTakes } from "./verify-helpers.mjs"

const { values } = parseArgs({ options: { modules: { type: "string" }, keep: { type: "boolean" } } })
assert(values.modules && process.env.CHROMIUM, "Pass --modules and set CHROMIUM")
const SHOTS = "/tmp/caliper-verify-attachments"
rmSync(SHOTS, { recursive: true, force: true })
mkdirSync(SHOTS, { recursive: true })

/** A real PNG of one colour, so the browser can draw it. @param {number} size @param {[number, number, number]} rgb */
function png(size, [r, g, b]) {
  /** @param {Buffer} bytes */
  const crc = bytes => {
    let c = ~0
    for (const byte of bytes) {
      c ^= byte
      for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
    return ~c >>> 0
  }
  /** @param {string} type @param {Buffer} data */
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data])
    const out = Buffer.alloc(data.length + 12)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc(body), data.length + 8)
    return out
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [r, g, b]).flat())])
  const pixels = deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", pixels), chunk("IEND", Buffer.alloc(0))])
}
const RED = png(24, [230, 60, 60])
const TEAL = png(24, [40, 190, 170])
const GOLD = png(24, [240, 190, 60])

/** Every chat request the agent sends. @type {any[]} */
const requests = []
const model = createHttpServer((request, response) => {
  let body = ""
  request.on("data", chunk => { body += chunk })
  request.on("end", () => {
    requests.push(JSON.parse(body))
    response.writeHead(200, { "content-type": "text/event-stream" })
    const base = { id: "c1", object: "chat.completion.chunk", created: 0, model: "scripted" }
    response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "Done." } }] })}\n\n`)
    response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`)
    response.end("data: [DONE]\n\n")
  })
})
await new Promise(done => model.listen(0, "127.0.0.1", () => done(undefined)))
const modelPort = /** @type {import("node:net").AddressInfo} */ (model.address()).port

const root = mkdtempSync(join(tmpdir(), "caliper-attachments-"))
/** @param {string} file @param {string} code */
const write = (file, code) => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), code)
}
const files = {
  "package.json": JSON.stringify({ name: "attachments-consumer", type: "module", exports: { ".": "./src/index.ts" } }),
  "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }),
  "src/index.ts": 'import "./app.css"\n',
  "src/app.css": ".card { padding: 16px; background: #223; color: white; }\n",
  "src/Card.part.tsx": 'export default function Part() { return <div className="card">Hello</div> }\n',
}
for (const [file, code] of Object.entries(files)) write(file, code)
symlinkSync(resolve(values.modules), join(root, "node_modules"), "dir")
process.env.CALIPER_VERIFY_KEY = "local"

const server = await createServer({
  root, cacheDir: join(root, ".vite"), configFile: false, logLevel: "silent",
  plugins: [caliper({ agent: { model: "scripted", baseUrl: `http://127.0.0.1:${modelPort}/v1`, apiKeyEnv: "CALIPER_VERIFY_KEY", reasoning: "off" } })],
  server: { host: "127.0.0.1", port: 0 },
})
await server.listen()
const url = server.resolvedUrls?.local[0] ?? ""
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
/** @type {string[]} */
const passed = []
/** @param {string} name @param {() => Promise<void>} check */
async function step(name, check) {
  await check()
  passed.push(name)
  console.log(`ok  ${name}`)
}

/** The base64 of every image in one chat request, in order. @param {any} request */
const sentImages = request => request.messages
  .filter((/** @type {any} */ message) => message.role === "user" && Array.isArray(message.content))
  .flatMap((/** @type {any} */ message) => message.content)
  .filter((/** @type {any} */ part) => part.type === "image_url")
  .map((/** @type {any} */ part) => String(part.image_url.url).replace(/^data:image\/png;base64,/, ""))

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  /** @type {string[]} */
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  await page.goto(`${new URL("__caliper/", url).href}#part=src/Card.part.tsx&device=rg353m`)
  await page.locator(`${cal.prompt}:not([disabled])`).waitFor()

  /**
   * Screenshot reference composer controls at each size. Check reachability
   * through native disclosures; viewport and region-scroll layout remain deferred.
   *
   * @param {string} label
   * @param {string[]} selectors
   */
  const ladder = async (label, selectors) => {
    /** @type {Record<string, string>} */
    const found = {}
    for (const [width, height] of [[1600, 1000], [1000, 720], [700, 900], [420, 820]]) {
      await page.setViewportSize({ width, height })
      await page.waitForTimeout(150)
      const controls = []
      for (const selector of selectors) {
        const control = await reveal(page, page.locator(selector).first())
        assert(await control.isVisible(), `${selector} reachable at ${width}x${height}`)
        controls.push(`${selector} present; viewport fit NOT PROVEN`)
      }
      found[`${width}x${height}`] = controls.join(", ")
      await page.screenshot({ path: join(SHOTS, `${label}-${width}x${height}.png`) })
    }
    await page.setViewportSize({ width: 1600, height: 1000 })
    return found
  }
  deferLayout(["Attachment composer controls shown without scrolling versus inside panel scrolling at 1600×1000, 1000×720, 700×900 and 420×820", "Composer control rectangles fully inside viewport with three images at those four sizes"])
  await page.locator(cal.prompt).fill("Match the reference colours")
  const before = await ladder("before", [cal.attach, cal.start])

  await step("the file picker attaches images and refuses a type the model cannot read", async () => {
    const picker = page.waitForEvent("filechooser")
    await page.locator(cal.attach).click()
    await (await picker).setFiles([
      { name: "red.png", mimeType: "image/png", buffer: RED },
      { name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") },
      { name: "teal.png", mimeType: "image/png", buffer: TEAL },
    ])
    await page.locator(`${cal.attachments} img`).nth(1).waitFor()
    assert.equal(await page.locator(`${cal.attachments} img`).count(), 2)
    assert.equal(await page.locator(`${cal.composer} [role="alert"]`).textContent(), '"logo.svg" is not a PNG, JPEG, WebP or GIF image.')
  })

  await step("a dropped image joins them", async () => {
    await page.evaluate(bytes => {
      const transfer = new DataTransfer()
      transfer.items.add(new File([new Uint8Array(bytes)], "gold.png", { type: "image/png" }))
      const composer = /** @type {HTMLElement} */ (document.querySelector('[data-cal="composer"]'))
      composer.dispatchEvent(new DragEvent("dragover", { dataTransfer: transfer, bubbles: true, cancelable: true }))
      composer.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }))
    }, [...GOLD])
    await page.locator(`${cal.attachments} img`).nth(2).waitFor()
    assert.deepEqual(await page.locator(`${cal.attachments} img`).evaluateAll(images => images.map(image => image.getAttribute("alt"))), ["red.png", "teal.png", "gold.png"])
  })

  await step("every composer control stays reachable at each size, with three images", async () => {
    const after = await ladder("attached", [cal.attach, cal.start, cal.attachmentRemove])
    for (const size of Object.keys(after)) {
      console.log(`    ${size} before: ${before[size]}\n    ${size} after:  ${after[size]}`)
    }
  })

  await step("paste attaches images, keeps the four-image limit, and refuses oversized files", async () => {
    await page.locator(cal.prompt).evaluate((node, bytes) => {
      const transfer = new DataTransfer()
      for (const name of ["pasted.png", "fifth.png"]) transfer.items.add(new File([new Uint8Array(bytes)], name, { type:"image/png" }))
      node.dispatchEvent(new ClipboardEvent("paste", { clipboardData:transfer, bubbles:true, cancelable:true }))
    }, [...TEAL])
    await page.locator(`${cal.attachments} img`).nth(3).waitFor()
    assert.equal(await page.locator(`${cal.attachments} img`).count(), 4)
    assert.match(await page.locator(`${cal.composer} [role="alert"]`).innerText(), /at most 4 images.*fifth.png/)
    assert.equal(await page.locator(cal.attach).isDisabled(), true)
    await page.locator(cal.attachments).getByRole("button", { name:"Remove pasted.png", exact:true }).click()
    await page.locator(cal.prompt).evaluate(node => {
      const transfer = new DataTransfer()
      transfer.items.add(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "too-big.png", { type:"image/png" }))
      node.dispatchEvent(new ClipboardEvent("paste", { clipboardData:transfer, bubbles:true, cancelable:true }))
    })
    await page.locator(`${cal.composer} [role="alert"]`).filter({ hasText:"too-big.png" }).waitFor()
    assert.equal(await page.locator(`${cal.attachments} img`).count(), 3)
  })

  await step("removing an image keeps the others", async () => {
    await page.locator(cal.attachments).getByRole("button", { name: "Remove teal.png", exact: true }).click()
    assert.deepEqual(await page.locator(`${cal.attachments} img`).evaluateAll(images => images.map(image => image.getAttribute("alt"))), ["red.png", "gold.png"])
  })

  let take = ""
  await step("a new take sends the attached images to the model after the render", async () => {
    await page.locator(cal.prompt).press("Control+Enter")
    await page.locator(`${cal.log} img`).nth(1).waitFor({ timeout: 60_000 })
    take = String(await page.evaluate(() => new URLSearchParams(location.hash.slice(1)).get("take")))
    const [finished] = await waitTakes(new URL("__caliper/", url).href, [take])
    assert.equal(finished?.run._tag, "Idle")
    assert.equal(await page.locator(`${cal.attachments} img`).count(), 0, "the tray empties once the take starts")
    const first = requests[0]
    assert(first, "the model got a request")
    const images = sentImages(first)
    assert.equal(images.length, 3, "the render, then two attached images")
    assert.deepEqual(images.slice(1), [RED.toString("base64"), GOLD.toString("base64")])
    const text = JSON.stringify(first)
    assert(text.includes("Images I attached to this prompt: red.png, gold.png."))
  })

  await step("the log shows the images the prompt carried, served from the take", async () => {
    await page.waitForFunction(selector => [...document.querySelectorAll(selector)].every(image => /** @type {HTMLImageElement} */ (image).naturalWidth === 24), `${cal.log} img`)
    const drawn = await page.locator(`${cal.log} img`).evaluateAll(images => images.map(image => /** @type {HTMLImageElement} */ (image).naturalWidth))
    assert.deepEqual(drawn, [24, 24])
    await page.screenshot({ path: join(SHOTS, "log.png") })
  })

  await step("a follow-up carries its own image", async () => {
    await page.locator(`${cal.composer} input[type="file"]`).setInputFiles([{ name: "teal.png", mimeType: "image/png", buffer: TEAL }])
    await page.locator(`${cal.attachments} img`).first().waitFor()
    await page.locator(cal.prompt).fill("Now this one")
    await (await reveal(page, page.locator(`${cal.follow}[data-take="${take}"]`))).click()
    await page.locator(`${cal.log} img[alt="teal.png"]`).waitFor({ timeout: 60_000 })
    const [finished] = await waitTakes(new URL("__caliper/", url).href, [take])
    assert.equal(finished?.run._tag, "Idle")
    const last = requests.at(-1)
    const lastUser = last.messages.filter((/** @type {any} */ message) => message.role === "user").at(-1)
    const images = lastUser.content.filter((/** @type {any} */ part) => part.type === "image_url")
    assert.equal(images.length, 1)
    assert.equal(String(images[0].image_url.url), `data:image/png;base64,${TEAL.toString("base64")}`)
  })

  await step("modified Enter sends a typed follow-up to the selected take", async () => {
    const requestCount = requests.length
    await page.locator(cal.prompt).fill("Keyboard follow-up")
    await page.locator(cal.prompt).press("Control+Shift+Enter")
    await page.locator(cal.log).getByText("Keyboard follow-up", { exact:true }).waitFor({ timeout:60_000 })
    const [finished] = await waitTakes(new URL("__caliper/", url).href, [take])
    assert.equal(finished?.run._tag, "Idle")
    assert.equal(requests.length, requestCount + 1)
    assert(JSON.stringify(requests.at(-1)).includes("Keyboard follow-up"))
  })

  await step("discard removes the take's images", async () => {
    assert(existsSync(join(root, ".caliper/takes", `${take}.images`, "3.png")))
    page.once("dialog", dialog => void dialog.accept())
    await page.locator(`${cal.discard}[data-take="${take}"]`).click()
    await page.locator(`${cal.nav} ${cal.navTake}[data-take="${take}"]`).waitFor({ state: "detached" })
    assert(!existsSync(join(root, ".caliper/takes", `${take}.images`)))
  })

  assert.deepEqual(errors, [], "the chrome threw no errors")
  console.log(`\n${passed.length} behavioral checks passed; layout NOT PROVEN. Screenshots: ${SHOTS}`)
} finally {
  await browser.close()
  await server.close()
  model.close()
  if (!values.keep) rmSync(root, { recursive: true, force: true })
  else console.log(`Kept ${root}`)
}
