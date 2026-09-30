#!/usr/bin/env -S nix develop -c node
// Runs real public browser gates against the reference renderer. No source or fetch replacement.
import { spawn } from "node:child_process"
import { createServer as createHttpServer } from "node:http"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"
import { caliper } from "../src/plugin.js"

const checkout = fileURLToPath(new URL("../", import.meta.url))
const modules = join(checkout, "node_modules")
const evidence = mkdtempSync(join(tmpdir(), "caliper-core-gates-"))
const root = mkdtempSync(join(tmpdir(), "caliper-core-subject-"))
/** @type {Array<{name: string, command: string[], code: number | null, elapsedMs: number}>} */
const summary = []
const only = process.argv.slice(2)
/** @param {string} file @param {string} source */
const put = (file, source) => { const path = join(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, source) }
const source = 'import { Chip } from "./Chip"\nexport default function Part() { return <Chip /> }\nexport function Busy() { return <Chip busy /> }\n'
put("package.json", JSON.stringify({ name: "reference-live-subject", type: "module", exports: { ".": "./src/index.ts" } }))
put("tsconfig.json", JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }))
put("src/index.ts", 'import "./global.css"; export {}\n')
put("src/global.css", 'body { margin: 0; } :root { --palette-dark: #112233; --palette-light: #ddeeff; }\n')
put("src/Chip.css", '.chip { --chip-pad: 12px; padding: var(--chip-pad); color: #112233; }\n')
put("src/Chip.part.tsx", source)
put("src/Chip.tsx", 'import "./Chip.css"\n\nexport function Chip({ busy = false }: { busy?: boolean }) {\n  return <button className="chip">{busy ? "Busy chip" : "Chip default"}</button>\n}\n')
symlinkSync(resolve(modules), join(root, "node_modules"), "dir")
// The public take/plan gate exercises actual model transport against a deterministic local endpoint.
const model = createHttpServer((request, response) => {
  let body = ""
  request.on("data", chunk => { body += chunk })
  request.on("end", () => {
    const call = JSON.parse(body)
    const planner = call.tools?.find((/** @type {{function?: {name?: string}}} */ tool) => tool.function?.name === "propose_directions")
    const delta = planner ? { role: "assistant", tool_calls: [{ index: 0, id: "directions", type: "function", function: { name: "propose_directions", arguments: JSON.stringify({ directions: [{ title: "Compact", brief: "Use the compact state." }, { title: "Readable", brief: "Keep the label readable." }, { title: "Strange", brief: "Break the current pattern with a different composition.", strange: true }] }) } }] } : { role: "assistant", content: "Done." }
    response.writeHead(200, { "content-type": "text/event-stream" })
    const base = { id: "local", object: "chat.completion.chunk", created: 0, model: "scripted" }
    response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta }] })}\n\n`)
    response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: planner ? "tool_calls" : "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`)
    response.end("data: [DONE]\n\n")
  })
})
await new Promise(resolve => model.listen(0, "127.0.0.1", () => resolve(undefined)))
const modelAddress = model.address()
if (!modelAddress || typeof modelAddress === "string") throw new Error("The local endpoint did not start.")
process.env.CALIPER_CORE_VERIFY_KEY = "local"
const server = await createServer({ root, configFile: false, cacheDir: join(root, ".vite"), logLevel: "silent", plugins: [caliper({ wrap: false, agent: { model: "scripted", baseUrl: `http://127.0.0.1:${modelAddress.port}/v1`, apiKeyEnv: "CALIPER_CORE_VERIFY_KEY", reasoning: "off", skills: false } })], server: { host: "127.0.0.1", port: 0 } })
await server.listen()
const url = server.resolvedUrls?.local[0]
if (!url) throw new Error("The subject did not start.")
/** @type {Array<[string, string[]]>} */
const specs = [
  ["browser", ["--url", url, "--root", root]],
  ["code", ["--url", url, "--root", root, "--part", "src/Chip.part.tsx", "--reference"]],
  ["takes", ["--url", url, "--part", "src/Chip.part.tsx", "--prompt", "Use three directions", "--takes", "3"]],
  ...["attachments", "css-loading", "scenarios", "checks", "checks-ui", "expectations", "frame-commit", "authored-checks", "authored-agent-cli", "authored-ui", "authored-release", "knobs", "pwa"].map(name => /** @type {[string, string[]]} */ ([name, ["--modules", modules]])),
  ["integration", ["--modules", modules, "--reference"]],
  ["authored-regressions", ["--modules", modules, "--reference"]],
  ["knobs-product", ["--root", root, "--part", "src/Chip.part.tsx"]],
  ...["fast-saves", "authored-package"].map(name => /** @type {[string, string[]]} */ ([name, []])),
]
console.log(`Reference gate evidence: ${evidence}`)
try {
  for (const [name, args] of specs) {
    if (only.length && !only.includes(name)) continue
    const command = [process.execPath, `scripts/verify-${name}.mjs`, ...args]
    console.log(`RUN ${command.join(" ")}`)
    const started = Date.now()
    let stdout = "", stderr = ""
    const child = spawn(command[0], command.slice(1), { cwd: checkout, env: { ...process.env, CALIPER_TEST_MODULES: modules }, stdio: ["ignore", "pipe", "pipe"] })
    child.stdout.on("data", chunk => { stdout += chunk; process.stdout.write(chunk); writeFileSync(join(evidence, `${name}.stdout`), stdout) })
    child.stderr.on("data", chunk => { stderr += chunk; process.stderr.write(chunk); writeFileSync(join(evidence, `${name}.stderr`), stderr) })
    const code = await new Promise(/** @param {(value: number | null) => void} resolve */ (resolve, reject) => { child.on("error", reject); child.on("close", resolve) })
    const record = { name, command, code, elapsedMs: Date.now() - started }
    summary.push(record)
    writeFileSync(join(evidence, "summary.json"), JSON.stringify(summary, null, 2))
    if (code !== 0) console.error(`FAILED ${name}: ${code}`)
  }
  if (summary.some(result => result.code !== 0)) process.exitCode = 1
} finally {
  await server.close()
  model.closeAllConnections()
  await new Promise(resolve => model.close(() => resolve(undefined)))
  rmSync(root, { recursive: true, force: true })
  console.log(`Reference gate evidence: ${evidence}`)
}
