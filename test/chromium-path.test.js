import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromiumExecutable } from "../src/render/chromium.js"

describe("chromiumExecutable", () => {
  test("CHROMIUM wins over Playwright's browser", () => {
    expect(chromiumExecutable({ CHROMIUM: "/opt/chromium" }, () => "/never")).toBe("/opt/chromium")
  })

  test("without CHROMIUM, uses Playwright's installed Chromium when the file exists", () => {
    const file = join(mkdtempSync(join(tmpdir(), "caliper-chromium-")), "chrome")
    writeFileSync(file, "")
    expect(chromiumExecutable({}, () => file)).toBe(file)
  })

  test("without CHROMIUM and without an installed browser, there is no executable", () => {
    expect(chromiumExecutable({}, () => "/no/such/chrome")).toBeUndefined()
    expect(chromiumExecutable({ CHROMIUM: "" }, () => { throw new Error("no registry") })).toBeUndefined()
  })
})
