// @ts-check
import { describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runNodeWorker } from "../src/render/node-worker.js"

describe("the browser worker", () => {
  test("refuses to run under Bun, so a `node` that is Bun cannot fork without limit", async () => {
    // A `node` that is really Bun, the way `bunx --bun` sets PATH.
    // Trip-wire: a second start exits at once, so a broken guard cannot fork-bomb the test machine.
    const bin = mkdtempSync(join(tmpdir(), "caliper-bun-node-"))
    const shim = join(bin, "node")
    writeFileSync(shim, `#!/bin/sh\n[ -n "$CALIPER_SHIM_DEPTH" ] && { echo recursed >&2; exit 97; }\nCALIPER_SHIM_DEPTH=1 exec ${process.execPath} "$@"\n`)
    chmodSync(shim, 0o755)
    const path = process.env.PATH
    process.env.PATH = `${bin}:${path}`
    try {
      const run = runNodeWorker({ type: "render", input: { url: "http://127.0.0.1:1", jobs: [], out: bin, executablePath: "/nonexistent" } })
      await expect(run).rejects.toThrow("started under Bun, not Node")
    } finally {
      process.env.PATH = path
      rmSync(bin, { recursive: true, force: true })
    }
  })
})
