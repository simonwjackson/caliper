#!/usr/bin/env -S nix shell nixpkgs#nodejs nixpkgs#bun --command node
// Real linked/packed consumers. No consumer assertion dependencies or runtime shims.
import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { once } from "node:events"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs, promisify } from "node:util"
import { DEVICES } from "../src/client/device-frame.js"

const { values } = parseArgs({ options: { out: { type: "string" }, keep: { type: "boolean", default: false } } })
assert(process.env.CHROMIUM, "Set CHROMIUM to a Chromium executable")
const chromiumPath = process.env.CHROMIUM
const packageRoot = fileURLToPath(new URL("../", import.meta.url))
const destination = resolve(values.out ?? tmpdir())
mkdirSync(destination, { recursive: true })
const evidence = mkdtempSync(join(destination, "caliper-authored-package-"))
const bun = process.env.BUN ?? "bun"
const exec = promisify(execFile)
const packageName = "@simonwjackson/caliper"
// Same React version as the archived authored-check spike; Vite matches this checkout.
const fixtureDependencies = { react: "19.1.0", "react-dom": "19.1.0", vite: "6.4.2" }
const part = "src/Retry.part.tsx"
const checkName = "retry loads the library"
const source = `import { useState } from "react"
import type { StateChecks } from "@simonwjackson/caliper/checks"
export default function Retry() {
  const [title, setTitle] = useState("Offline")
  return <main><h1>{title}</h1><button onClick={() => setTimeout(() => setTitle("Library"), 20)}>Retry</button></main>
}
export const checks = {
  default: {
    "retry loads the library": async ({ canvas, input, expect, waitFor }) => {
      await input.click(canvas.getByRole("button", { name: "Retry" }))
      await waitFor(() => expect(canvas.getByRole("heading")).toHaveTextContent("Library"))
    },
  },
} satisfies StateChecks
`
const brokenSource = source.replace('setTitle("Library")', 'setTitle("Unavailable")')
assert.notEqual(source, brokenSource)
/** @type {import('node:child_process').ChildProcess | undefined} */
let activeServer
/** @type {import('playwright-core').Browser | undefined} */
let activeBrowser
/** @type {string[]} */
const consumers = []
/** @type {Array<Record<string, unknown>>} */
const results = []

/** @param {string} path @param {string} text */
function write(path, text) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }
/** @param {string} command @param {string[]} args @param {string} cwd @param {string} log */
async function command(command, args, cwd, log) {
  try {
    const result = await exec(command, args, { cwd, env: process.env, timeout: 180_000, maxBuffer: 16_000_000, killSignal: "SIGKILL" })
    write(join(evidence, `${log}.stdout`), result.stdout)
    write(join(evidence, `${log}.stderr`), result.stderr)
    return result.stdout
  } catch (error) {
    if (error && typeof error === "object") {
      if ("stdout" in error) write(join(evidence, `${log}.stdout`), String(error.stdout))
      if ("stderr" in error) write(join(evidence, `${log}.stderr`), String(error.stderr))
    }
    throw error
  }
}
/** @param {string} root @param {string} mode */
async function startServer(root, mode) {
  const child = spawn(process.execPath, [join(root, "verify-server.mjs")], {
    cwd: root,
    env: { ...process.env, CALIPER_PACKAGE_REQUESTS: join(evidence, `${mode}-server-requests.ndjson`) },
    stdio: ["ignore", "pipe", "pipe"],
  })
  activeServer = child
  let output = ""
  let errors = ""
  child.stderr.on("data", chunk => { errors += chunk; write(join(evidence, `${mode}-server.stderr`), errors) })
  const ready = new Promise(/** @param {(value: {url: string, plugin: string, vite: string, react: string, reactDom: string}) => void} resolve */ (resolve, reject) => {
    child.on("error", reject)
    child.on("close", code => reject(new Error(`Consumer server exited ${code}: ${errors}`)))
    child.stdout.on("data", chunk => {
      output += chunk
      write(join(evidence, `${mode}-server.stdout`), output)
      const line = output.split("\n").find(line => line.startsWith("CALIPER_PACKAGE_READY "))
      if (line) resolve(JSON.parse(line.slice("CALIPER_PACKAGE_READY ".length)))
    })
  })
  let timer
  try {
    return await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Consumer startup timed out: ${errors}`)), 30_000) })])
  } finally { clearTimeout(timer) }
}
async function stopServer() {
  const child = activeServer
  if (!child) return
  activeServer = undefined
  if (child.exitCode !== null || child.signalCode !== null) return
  const closed = once(child, "close")
  child.kill("SIGTERM")
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000)
  try { await closed } finally { clearTimeout(timer) }
}
/** @param {string} url */
const libraryRequest = url => /check[-_]libraries|check-runtime|testing-library|jest-dom|@vitest|\/chai[./_-]/i.test(decodeURIComponent(url))
/** @param {string} url */
async function readProject(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  assert.equal(response.status, 200, await response.clone().text())
  return response.json()
}

console.log(`Package gate evidence: ${evidence}`)
try {
  await command(bun, ["install", "--frozen-lockfile"], packageRoot, "caliper-install")
  const tarball = join(evidence, "caliper.tgz")
  await command(bun, ["pm", "pack", "--filename", tarball, "--ignore-scripts"], packageRoot, "pack")
  assert(existsSync(tarball))
  const tarballSha256 = createHash("sha256").update(readFileSync(tarball)).digest("hex")
  const { chromium } = await import("playwright-core")

  for (const mode of ["linked", "packed"]) {
    const root = mkdtempSync(join(tmpdir(), `caliper-${mode}-consumer-`))
    consumers.push(root)
    const installedPackage = join(root, "node_modules", packageName)
    const dependencies = mode === "packed" ? { ...fixtureDependencies, [packageName]: tarball } : fixtureDependencies
    const manifest = { name: `caliper-${mode}-package-gate`, private: true, type: "module", exports: { ".": "./src/index.ts" }, dependencies }
    write(join(root, "package.json"), JSON.stringify(manifest, null, 2))
    await command(bun, ["install", "--linker", "isolated"], root, `${mode}-install`)
    if (mode === "linked") {
      // Link only Caliper, exactly as a linked package resolves; leave the global
      // Bun link registry and the user's active linked consumer untouched.
      mkdirSync(dirname(installedPackage), { recursive: true })
      symlinkSync(packageRoot, installedPackage, "dir")
      manifest.dependencies = { ...fixtureDependencies, [packageName]: `link:${packageRoot}` }
      write(join(root, "package.json"), JSON.stringify(manifest, null, 2))
    }
    assert.deepEqual(Object.keys(manifest.dependencies).sort(), [packageName, "react", "react-dom", "vite"].sort())
    for (const dependency of ["@testing-library/dom", "@testing-library/jest-dom", "@vitest/expect", "chai"]) {
      assert(!existsSync(join(root, "node_modules", dependency)), `${mode} consumer must not have a direct ${dependency} installation`)
    }
    const resolvedPackage = realpathSync(installedPackage)
    if (mode === "linked") assert.equal(resolvedPackage, realpathSync(packageRoot))
    else {
      assert(resolvedPackage.startsWith(root + sep), "Packed Caliper must be inside the isolated consumer")
      assert.notEqual(resolvedPackage, realpathSync(packageRoot))
    }
    write(join(evidence, `${mode}-package.json`), JSON.stringify(manifest, null, 2))
    copyFileSync(join(root, "bun.lock"), join(evidence, `${mode}-bun.lock`))
    write(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }))
    write(join(root, "src/index.ts"), "export {}\n")
    write(join(root, part), source)
    // Seed a genuine on-disk take before startup. The server and CLI read it
    // through their normal take discovery; no private runtime import is used.
    write(join(root, ".caliper/.gitignore"), "*\n")
    write(join(root, ".caliper/takes/1.json"), JSON.stringify({ part, state: "default", device: "rg353m", created: Date.now() }))
    write(join(root, ".caliper/takes/1", part), brokenSource)
    copyFileSync(fileURLToPath(new URL("./fixtures/authored-package-server.mjs", import.meta.url)), join(root, "verify-server.mjs"))

    const ready = await startServer(root, mode)
    assert(ready && typeof ready === "object" && "url" in ready && typeof ready.url === "string")
    assert.equal(realpathSync(ready.plugin), join(resolvedPackage, "src/plugin.js"))
    assert.equal(ready.vite, fixtureDependencies.vite)
    assert.equal(ready.react, fixtureDependencies.react)
    assert.equal(ready.reactDom, fixtureDependencies["react-dom"])
    const url = ready.url
    const original = await readProject(new URL("/__caliper/project.json", url).href)
    const take = await readProject(new URL("/__caliper/project.json?take=1", url).href)
    write(join(evidence, `${mode}-project.json`), JSON.stringify(original, null, 2))
    write(join(evidence, `${mode}-take-project.json`), JSON.stringify(take, null, 2))
    const originalPart = original.parts.find((/** @type {{file:string}} */ item) => item.file === part)
    const takePart = take.parts.find((/** @type {{file:string}} */ item) => item.file === part)
    assert(originalPart && takePart)
    assert.deepEqual(originalPart.authoredCheckProblems ?? [], [])
    assert.deepEqual(takePart.authoredCheckProblems ?? [], [])
    assert.equal(originalPart.authoredChecks.default.length, 1)
    const declaration = originalPart.authoredChecks.default[0]
    assert.equal(declaration.name, checkName)
    assert(declaration.line > 0)
    assert.match(declaration.hash, /^[a-f0-9]{64}$/)
    assert.deepEqual(takePart.authoredChecks, originalPart.authoredChecks, "The broken take must preserve the original check declaration")

    activeBrowser = await chromium.launch({ executablePath: chromiumPath, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
    /** @type {string[]} */
    const previewRequests = []
    for (const device of DEVICES) {
      const context = await activeBrowser.newContext({ viewport: { width: device.cssWidth, height: device.cssHeight } })
      const page = await context.newPage()
      /** @type {string[]} */
      const errors = []
      page.on("pageerror", error => errors.push(error.message))
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()) })
      page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`) })
      page.on("requestfailed", request => errors.push(`Failed: ${request.url()}`))
      page.on("request", request => previewRequests.push(request.url()))
      await page.goto(new URL(`/__caliper/frame?part=${encodeURIComponent(part)}&state=default`, url).href)
      await page.waitForFunction(() => document.documentElement.dataset.caliperState === "Rendered")
      await page.getByRole("button", { name: "Retry" }).click()
      await page.getByRole("heading", { name: "Library", exact: true }).waitFor()
      assert.deepEqual(errors, [], `${mode} ordinary preview must render and behave without browser errors`)
      await context.close()
    }
    await activeBrowser.close()
    activeBrowser = undefined
    write(join(evidence, `${mode}-preview-requests.json`), JSON.stringify(previewRequests, null, 2))
    assert(previewRequests.some(url => url.includes("Retry.part.tsx")), "Observe the real product preview, not an empty page")
    assert.deepEqual(previewRequests.filter(libraryRequest), [], `${mode} normal previews must not fetch assertion/query bundles`)
    const requestsPath = join(evidence, `${mode}-server-requests.ndjson`)
    const beforeChecks = readFileSync(requestsPath, "utf8")
    assert(!beforeChecks.split("\n").filter(Boolean).some(line => libraryRequest(JSON.parse(line).url)), "Server sees no helper request before checks")

    const cli = join(installedPackage, "bin/caliper-render.mjs")
    /** @type {string[]} */
    const reportPaths = []
    for (const [name, selectedTake, expected] of [["original", undefined, "Passed"], ["broken-take", "1", "Failed"]]) {
      const args = [cli, "--url", url, "--part", part, "--state", "default", "--device", "*", "--check", "--chromium", chromiumPath, "--out", join(evidence, mode, name ?? "")]
      if (selectedTake) args.push("--take", selectedTake)
      const output = JSON.parse(await command(process.execPath, args, root, `${mode}-${name}-cli`))
      assert.equal(output.report.version, 2)
      assert.equal(output.report.run.termination, "Completed")
      assert.equal(output.report.run.stale, false)
      assert.equal(output.results.length, DEVICES.length)
      assert.deepEqual(output.results.map((/** @type {{device:string}} */ item) => item.device).sort(), DEVICES.map(device => device.id).sort())
      for (const [index, result] of output.results.entries()) {
        assert.equal(result.frame, "Rendered")
        assert.deepEqual(result.console, [])
        assert(result.authored, `${mode} ${name}: CLI result ${index} must include authored coverage, not silently omit it`)
        assert.deepEqual(result.authored, output.report.results[index]?.authored, "CLI results and saved report must agree")
        assert.equal(result.authored.status, expected, JSON.stringify(result.authored))
        assert.equal(result.authored.checks.length, 1)
        const check = result.authored.checks[0]
        assert.equal(check.name, checkName)
        assert.equal(check.status, expected, JSON.stringify(check))
        assert.deepEqual(check.source, { file: part, line: declaration.line })
        assert.equal(check.reason, expected === "Passed" ? "Completed" : "CheckError")
        if (expected === "Failed") assert.match(check.detail, /toHaveTextContent/)
        assert(check.image && existsSync(check.image), "Keep separate interaction evidence")
        assert.notEqual(check.image, result.png)
        assert.equal(result.authored.provenance.kind, selectedTake ? "Take" : "Original")
        if (selectedTake) {
          assert.equal(result.authored.provenance.take, selectedTake)
          assert.deepEqual(result.authored.provenance.files, [part])
          assert.deepEqual(result.authored.provenance.changedDeclarations, [])
        }
      }
      assert.deepEqual(JSON.parse(readFileSync(output.reportPath, "utf8")), output.report)
      reportPaths.push(output.reportPath)
    }
    const checkRequests = readFileSync(requestsPath, "utf8").slice(beforeChecks.length).split("\n").filter(Boolean).map(line => JSON.parse(line).url)
    assert(checkRequests.some((/** @type {string} */ url) => /check[-_]libraries/.test(url)), "The named CLI checks must actually fetch Vite's helper bundle")
    await stopServer()
    results.push({ mode, installation: ready, declaration, previewRequestCount: previewRequests.length, helperRequests: checkRequests.filter(libraryRequest), reportPaths })
    console.log(`PASS ${mode}: public discovery; ${DEVICES.length} previews without test libraries; named success and unchanged-check broken take on both devices`)
  }
  write(join(evidence, "summary.json"), JSON.stringify({ status: "Passed", tarballSha256, fixtureDependencies, results }, null, 2))
  console.log(`PASS: linked and isolated packed package gates. Evidence: ${evidence}`)
} catch (error) {
  write(join(evidence, "failure.txt"), error instanceof Error ? error.stack ?? error.message : String(error))
  console.error(`FAIL: package gate; evidence at ${evidence}`)
  throw error
} finally {
  try { await activeBrowser?.close() } finally {
    await stopServer()
    if (!values.keep) for (const root of consumers) rmSync(root, { recursive: true, force: true })
  }
}
