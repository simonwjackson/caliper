// @ts-check
import { describe, test, expect } from "bun:test"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { verifyIntegration } from "../src/agent/verify-integration.js"

/** @param {(result: (image: string, state?: string) => import('../src/render/render.js').RenderResult) => Promise<void>} run */
async function withRenders(run) {
  const root = mkdtempSync(join(tmpdir(), "caliper-check-"))
  try {
    let index = 0
    await run((image, state = "default") => {
      const png = join(root, `${index++}.png`)
      writeFileSync(png, image)
      return { part: "src/Chip.part.tsx", state, device: "iphone-16", viewport: { width: 640, height: 480 }, frame: "Rendered", png, problems: [], console: [], spill: null }
    })
  } finally { rmSync(root, { recursive: true, force: true }) }
}

describe("integration render evidence", () => {
  test("passes stable original coverage and a visible alternate", () => withRenders(async result => {
    const summary = await verifyIntegration({ originals: async () => [result("blue")], proposed: async () => [result("blue")], alternate: async () => [result("red", "Alternate")] })
    expect(summary).toContain("1 existing state/device renders")
    expect(summary).toContain("do not prove interaction")
  }))
  test("rejects an unstable original rather than declaring preservation", () => withRenders(async result => {
    let count = 0
    await expect(verifyIntegration({ originals: async () => [result(`${count++}`)], proposed: async () => [result("0")], alternate: async () => [result("red")] })).rejects.toThrow("unstable")
  }))
  test("rejects changed default output", () => withRenders(async result => {
    await expect(verifyIntegration({ originals: async () => [result("blue")], proposed: async () => [result("red")], alternate: async () => [result("red")] })).rejects.toThrow("changes an existing state")
  }))
  test("does not accept missing coverage", () => withRenders(async result => {
    await expect(verifyIntegration({ originals: async () => [result("blue")], proposed: async () => [], alternate: async () => [result("red")] })).rejects.toThrow("No states")
  }))
  test("accepts the real empty-state warning on unchanged original scenarios", () => withRenders(async result => {
    const empty = () => ({ ...result("empty"), frame: /** @type {const} */ ("Empty"), problems: [{ kind: /** @type {const} */ ("warning"), title: "src/Chip.part.tsx rendered nothing: its component returned null or an empty tree.", detail: "" }] })
    const summary = await verifyIntegration({ originals: async () => [empty()], proposed: async () => [empty()], alternate: async () => [result("red", "Alternate")] })
    expect(summary).toContain("match two stable baselines")
  }))
  test("allows intentional empty originals but not an empty alternate", () => withRenders(async result => {
    const empty = () => ({ ...result("empty"), frame: /** @type {const} */ ("Empty") })
    await expect(verifyIntegration({ originals: async () => [empty()], proposed: async () => [empty()], alternate: async () => [empty()] })).rejects.toThrow("visible content")
  }))
  test("rejects browser errors", () => withRenders(async result => {
    await expect(verifyIntegration({ originals: async () => [result("blue")], proposed: async () => [result("blue")], alternate: async () => [{ ...result("red"), console: ["Runtime failure"] }] })).rejects.toThrow("Render failed")
  }))
})
