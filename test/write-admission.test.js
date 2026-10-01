// @ts-check
// Decision 37: who may write to a project. The Caliper app checks the page's
// origin, the dev server checks the app's token, and every write endpoint
// takes only a POST with a JSON body. Each check is tested where a write
// crosses it, not on a module mounted by itself.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { manifest, withProject } from "./project-server.js"

const files = {
  "package.json": manifest(),
  "src/index.ts": 'import "./chip.css"\n',
  "src/chip.css": ".chip { color: blue }\n",
  "src/Chip.part.tsx": 'export default function Chip() { return <button className="chip">Chip</button> }\n',
}

// One write of each kind: the dev server answers code, knobs and checks; the app's agent answers takes and marks.
const writes = ["code/file", "knobs/write", "checks/run", "checks/cancel", "checks/approve", "takes", "marks"]

/**
 * @param {string} base the project's base in the app, or the dev server's own URL
 * @param {string} path below `__caliper/`
 * @param {Record<string, string>} headers
 * @param {string} [body]
 */
async function write(base, path, headers, body = "{}") {
  const response = await fetch(new URL(`__caliper/${path}`, base), { method: "POST", headers, body })
  return { status: response.status, error: /** @type {{ error?: string }} */ (await response.json()).error }
}

describe("write admission", () => {
  test("the app refuses a write from another site's page before any endpoint sees it", () => withProject({ files }, async ({ url, root }) => {
    for (const origin of ["https://evil.test", "null", "not a URL"]) {
      for (const path of writes) {
        const answer = await write(url, path, { "content-type": "application/json", origin }, JSON.stringify({ file: "src/chip.css", content: "x" }))
        expect({ path, origin, ...answer }).toEqual({ path, origin, status: 403, error: "Only the Caliper app's own page can change files and takes." })
      }
    }
    expect(readFileSync(join(root, "src/chip.css"), "utf8")).toBe(files["src/chip.css"])
  }))

  test("the dev server takes a write only with the app's token", () => withProject({ files }, async ({ viteUrl, root }) => {
    for (const authorization of [undefined, "Bearer not-the-token", "not-the-token"]) {
      for (const path of ["code/file", "knobs/write", "checks/run", "host"]) {
        const headers = /** @type {Record<string, string>} */ ({ "content-type": "application/json", ...(authorization ? { authorization } : {}) })
        const answer = await write(viteUrl, path, headers, JSON.stringify({ file: "src/chip.css", content: "x" }))
        expect({ path, authorization, status: answer.status }).toEqual({ path, authorization, status: 401 })
      }
    }
    expect(readFileSync(join(root, "src/chip.css"), "utf8")).toBe(files["src/chip.css"])
  }))

  test("every write endpoint takes only a JSON body", () => withProject({ files }, async ({ url }) => {
    for (const type of ["text/plain", "application/json-evil", "application/jsonp", "multipart/form-data"]) {
      for (const path of writes) {
        const answer = await write(url, path, { "content-type": type })
        expect({ path, type, ...answer }).toEqual({ path, type, status: 403, error: "Send a JSON body." })
      }
    }
    for (const type of ["application/json", "application/json; charset=utf-8", "Application/JSON"]) {
      for (const path of writes) {
        const answer = await write(url, path, { "content-type": type })
        expect({ path, type, status: answer.status }).toEqual({ path, type, status: 400 })
      }
    }
  }))
})
