import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const script = fileURLToPath(new URL("../scripts/check-release-version.mjs", import.meta.url))
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))

/** @param {string} refType @param {string} refName */
function check(refType, refName) {
  return spawnSync("node", [script], {
    env: { ...process.env, GITHUB_REF_TYPE: refType, GITHUB_REF_NAME: refName },
    encoding: "utf8",
  })
}

describe("release version", () => {
  test("accepts the tag for the actual package version", () => {
    const result = check("tag", `v${version}`)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(`matches package version ${version}`)
  })

  test("rejects a tag for another version", () => {
    const result = check("tag", "v999.0.0")
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`expected tag v${version}`)
  })

  test("rejects a branch even when its name matches the version", () => {
    expect(check("branch", `v${version}`).status).toBe(1)
  })

  test("rejects a missing ref", () => {
    expect(check("", "").status).toBe(1)
  })
})
