// @ts-check
import { expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)

test("public StateChecks context passes strict positive and negative type probes with library checking", () => {
  const output = execFileSync(process.execPath, [
    require.resolve("typescript/bin/tsc"),
    "--noEmit", "--strict", "--skipLibCheck", "false",
    "--module", "esnext", "--moduleResolution", "bundler", "--target", "es2022",
    "--types", "node", "test/authored-types.ts",
  ], { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", timeout: 25_000 })
  expect(output).toBe("")
}, 30_000)
