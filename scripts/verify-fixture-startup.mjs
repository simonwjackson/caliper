#!/usr/bin/env -S nix develop -c node
// Exercise real fixture HTTP/SSE and immediate source writes without rendering.
import assert from "node:assert/strict"
import { withProject, manifest } from "../test/project-server.js"
console.log(`fixture caller: ${process.versions.bun ? "Bun" : "Node"}`)
await withProject({ files: {
  "package.json": manifest(),
  "src/index.ts": "export {}",
  "src/Chip.css": ".chip { color: blue }",
  "src/Chip.part.tsx": "export default function Chip() { return <span>Chip</span> }\nexport function Busy() { return <span>Busy</span> }",
} }, async ({ get, url, write }) => {
  const project = await (await get("/__caliper/project.json")).json()
  assert.equal(project.parts[0].file, "src/Chip.part.tsx")
  const abort = new AbortController()
  const timeout = setTimeout(() => abort.abort(new Error("No immediate file-change event.")), 4000)
  const response = await fetch(new URL("__caliper/events", url), { signal: abort.signal })
  assert(response.body, "SSE response has no body")
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ""
  /** @param {string} wanted */
  async function until(wanted) {
    while (!text.includes(wanted)) {
      const { value, done } = await reader.read()
      assert(!done, "SSE ended before the expected event")
      text += decoder.decode(value)
    }
  }
  try {
    await until("event: takes")
    write("src/Chip.css", ".chip { color: red }")
    await until('event: code\ndata: {"file":"src/Chip.css","take":null}')
    console.log("PASS: real project HTTP snapshot and immediate source-change SSE")
  } finally {
    clearTimeout(timeout)
    abort.abort()
  }
})
console.log("PASS: fixture shutdown")
