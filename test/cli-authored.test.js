// @ts-check
import { expect, test } from "bun:test"
import { createServer } from "node:http"
import { fileURLToPath } from "node:url"

const cli = fileURLToPath(new URL("../bin/caliper-render.mjs", import.meta.url))
const authoredChecks = { default: [{ name: "retry", line: 2, hash: "abc" }] }
const authoredCheckProblems = ["Example.part.tsx:3: Invalid declaration"]
const devices = [{ id: "kiosk", name: "Kiosk", widthMm: 300, heightMm: 200, cssWidth: 1200, cssHeight: 800, viewportNote: "" }]
const project = { name: "consumer", parts: [{ file: "Example.part.tsx", name: "Example", states: [{ export: "default", name: "Default" }], authoredChecks, authoredCheckProblems }], devices }

/** @param {(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => void} handle */
async function serve(handle) {
  const server = createServer(handle)
  await new Promise(/** @param {(value: void) => void} resolve */ resolve => server.listen(0, "127.0.0.1", resolve))
  const address = /** @type {import('node:net').AddressInfo} */ (server.address())
  return { url: `http://127.0.0.1:${address.port}`, close: () => { server.closeAllConnections(); server.close() } }
}

test("CLI list requests the selected take and exposes authored declarations and diagnostics", async () => {
  let requested = ""
  const server = await serve((request, response) => {
    requested = request.url ?? ""
    response.setHeader("Content-Type", "application/json")
    response.end(JSON.stringify(project))
  })
  try {
    const child = Bun.spawn([process.execPath, cli, "--url", server.url, "--take", "7", "--list"], { stdout: "pipe", stderr: "pipe" })
    const output = await new Response(child.stdout).json()
    expect(await child.exited).toBe(0)
    expect(requested).toBe("/__caliper/project.json?take=7")
    expect(output.parts[0]).toMatchObject({ authoredChecks, authoredCheckProblems })
    expect(output.devices).toEqual([{ id: "kiosk", name: "Kiosk", cssWidth: 1200, cssHeight: 800, widthMm: 300 }])
  } finally { server.close() }
})

test("CLI says to restart a dev server whose older plugin sends no device list", async () => {
  const server = await serve((_request, response) => {
    response.setHeader("Content-Type", "application/json")
    response.end(JSON.stringify({ ...project, devices: undefined }))
  })
  try {
    const child = Bun.spawn([process.execPath, cli, "--url", server.url, "--list"], { stdout: "pipe", stderr: "pipe" })
    expect(await child.exited).toBe(2)
    expect((await new Response(child.stdout).json()).error).toContain("older Caliper plugin that sends no device list. Restart it.")
  } finally { server.close() }
})

for (const [signal, exitCode] of /** @type {const} */ ([["SIGINT", 130], ["SIGTERM", 143]])) {
  test(`CLI ${signal} cancels discovery and emits a non-success outcome`, async () => {
    /** @type {() => void} */
    let started = () => {}
    const entered = new Promise(/** @param {(value: void) => void} resolve */ resolve => { started = resolve })
    const server = await serve(() => { started() })
    const child = Bun.spawn([process.execPath, cli, "--url", server.url, "--part", "Example.part.tsx", "--check"], { stdout: "pipe", stderr: "pipe" })
    try {
      await entered
      child.kill(signal)
      const output = await new Response(child.stdout).text()
      expect(await child.exited).toBe(exitCode)
      expect(JSON.parse(output)).toMatchObject({ error: expect.stringContaining("Interrupted") })
    } finally { child.kill(); server.close() }
  })
}
