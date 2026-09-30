// @ts-check
import { expect, test } from "bun:test"
import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

// Browser transport runs in real Node, as the production browser worker does.
// Bun's Playwright transport can stall before an assertion (README runtime limit).
const browserTest = test.skipIf(!process.env.CHROMIUM || !process.env.CALIPER_TEST_MODULES)
browserTest("part navigation: layer order, independent disclosure, all states, keyboard, search, deep links and size", async () => {
  const { stdout, stderr } = await promisify(execFile)("node", [fileURLToPath(new URL("./chrome-navigation-browser.ts", import.meta.url))], { env:process.env, timeout:120_000, maxBuffer:2_000_000 })
  process.stderr.write(stderr)
  process.stdout.write(stdout)
  expect(stdout).toContain("PASS: layer order")
}, 130_000)
