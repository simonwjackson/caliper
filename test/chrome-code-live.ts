#!/usr/bin/env -S nix develop -c node
/** Run the real code browser gate on a disposable two-state consumer. No model calls. */
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { createServer } from "vite"
import { caliper } from "../src/plugin.js"

const { values } = parseArgs({ options: { out: { type: "string", default: "/tmp/caliper-code-live" }, reference: { type: "boolean", default: false } } })
assert(process.env.CHROMIUM, "Run through nix develop to supply CHROMIUM")
const root = mkdtempSync(join(tmpdir(), "caliper-code-live-"))
const part = "src/Chip.part.tsx"
const component = 'import "./Chip.css"\n\nexport function Chip({ busy = false }: { busy?: boolean }) {\n  return <button disabled={busy}>{busy ? "Busy" : "Ready"}</button>\n}\n'
const files = {
  "package.json": JSON.stringify({ name: "code-live-consumer", type: "module", exports: { ".": "./src/index.ts" } }),
  "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }),
  "src/index.ts": 'import "./global.css"\n',
  "src/global.css": "body { margin: 0 }\n",
  "src/Chip.tsx": component,
  "src/Chip.css": "button { font-size: 20px; padding: 12px }\n",
  [part]: 'import { Chip } from "./Chip"\nexport default function Part() { return <Chip /> }\nexport function Busy() { return <Chip busy /> }\n',
}
for (const [file, content] of Object.entries(files)) {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), content)
}
symlinkSync(resolve("node_modules"), join(root, "node_modules"), "dir")
const server = await createServer({ root, cacheDir: join(root, ".vite"), configFile: false, logLevel: "silent", plugins: [caliper({ wrap: false })], server: { host: "127.0.0.1", port: 0 } })
try {
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  assert(url, "The fixture server has a URL")
  const project = await (await fetch(new URL("__caliper/project.json", url))).json()
  assert.deepEqual(project.parts.find((entry: { file: string }) => entry.file === part).states.map((state: { export: string }) => state.export), ["default", "Busy"])
  console.log(`code fixture: ${url} root=${root}, two rendered states`)
  const status = await new Promise<number>((done, reject) => {
    const child = spawn(process.execPath, [resolve("scripts/verify-code.mjs"), "--url", url, "--root", root, "--part", part, "--out", values.out!, ...(values.reference ? ["--reference"] : [])], { stdio: "inherit" })
    child.once("error", reject)
    child.once("exit", code => done(code ?? 1))
  })
  assert.equal(readFileSync(join(root, "src/Chip.tsx"), "utf8"), component, "The browser gate restored the real component")
  assert.equal((await (await fetch(new URL("__caliper/takes.json", url))).json()).takes.length, 0, "The browser gate discarded its take")
  console.log("verified cleanup: real source restored; zero takes retained")
  process.exitCode = status
} finally {
  if (server.httpServer && "closeAllConnections" in server.httpServer) server.httpServer.closeAllConnections()
  await server.close()
  rmSync(root, { recursive: true, force: true })
}
