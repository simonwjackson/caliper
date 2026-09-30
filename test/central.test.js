// @ts-check
// Decision 37: the registry, the plugin's token and host endpoint, and the Caliper app's routing.
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { caliper } from "../src/plugin.js"
import { newToken, projectId, PROTOCOL, readRegistry, tokenMatches, writeEntry } from "../src/central/registry.js"
import { projectViews, socketHost } from "../src/central/server.js"
import { decode, encode } from "../src/host/wire.js"
import { readSettings } from "../src/central/config.js"
import { manifest, withProject } from "./project-server.js"

const files = {
  "package.json": manifest(),
  "src/index.ts": "export {}\n",
  "src/Chip.part.tsx": "export default function Chip() { return <button>Chip</button> }\n",
}

/** @param {Partial<import("../src/central/registry.js").Entry>} [overrides] */
const entry = (overrides = {}) => ({
  protocol: PROTOCOL, id: "0123456789ab", pid: process.pid, root: "/tmp/x", name: "x",
  url: "http://127.0.0.1:5173/", base: "/", token: "t", started: new Date(0).toISOString(), ...overrides,
})

/**
 * The fixture host keeps its registry in its own folder; find the entry by the project's id.
 *
 * @param {string} root
 */
function registered(root) {
  const id = projectId(root)
  for (const name of readdirSync(tmpdir()).filter(folder => folder.startsWith("caliper-test-registry-"))) {
    const found = readRegistry(join(tmpdir(), name)).find(item => item.id === id)
    if (found) return found
  }
  throw new Error(`No registry entry for ${root}.`)
}

describe("the registry", () => {
  test("writes one private file per server, and the reader drops a dead server's file", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "caliper-registry-")), "servers")
    const remove = writeEntry(dir, entry())
    writeEntry(dir, entry({ pid: 2 ** 22 + 12345, id: "ba9876543210" }))
    writeFileSync(join(dir, "broken.json"), "{")
    expect((statSync(dir).mode & 0o777).toString(8)).toBe("700")
    for (const name of readdirSync(dir).filter(file => file !== "broken.json")) expect((statSync(join(dir, name)).mode & 0o777).toString(8)).toBe("600")
    expect(readRegistry(dir).map(item => item.id)).toEqual(["0123456789ab"])
    expect(readdirSync(dir).some(name => name.includes("ba9876543210"))).toBe(false)
    expect(readdirSync(dir)).toContain("broken.json")
    remove()
    expect(readRegistry(dir)).toEqual([])
  })

  test("names a project by its root's real path, and compares tokens exactly", () => {
    const root = mkdtempSync(join(tmpdir(), "caliper-id-"))
    const link = `${root}-link`
    symlinkSync(root, link, "dir")
    expect(projectId(link)).toBe(projectId(root))
    expect(projectId(root)).toMatch(/^[0-9a-f]{12}$/)
    const token = newToken()
    expect(tokenMatches(`Bearer ${token}`, token)).toBe(true)
    expect(tokenMatches(`Bearer ${token}x`, token)).toBe(false)
    expect(tokenMatches(undefined, token)).toBe(false)
  })

  test("the app shows a duplicate or an old plugin with its reason and routes to neither", () => {
    const views = projectViews([entry(), entry({ pid: 7 }), entry({ id: "aaaaaaaaaaaa", name: "old", protocol: PROTOCOL - 1 }), entry({ id: "bbbbbbbbbbbb", name: "ok" })])
    expect(views.map(view => [view.name, view.status])).toEqual([["ok", "Ready"], ["old", "Protocol"], ["x", "Duplicate"]])
    expect(views.find(view => view.name === "ok")?.chrome).toBe("/__caliper/p/bbbbbbbbbbbb/__caliper/")
  })
})

describe("the plugin", () => {
  test("refuses the agent option and HMR settings that would move the socket", () => {
    expect(() => caliper(/** @type {any} */ ({ agent: { model: "m" } }))).toThrow("~/.config/caliper/config.json")
    const plugin = /** @type {any} */ (caliper())
    expect(() => plugin.config({ root: mkdtempSync(join(tmpdir(), "caliper-hmr-")), server: { hmr: { port: 1234 } } })).toThrow("server.hmr.port")
    const config = plugin.config({ root: mkdtempSync(join(tmpdir(), "caliper-hmr-")) })
    expect(config.server.hmr.path).toMatch(/^__caliper\/hmr\/[0-9a-f]{12}$/)
  })

  test("takes writes only with its token, and says hello with its protocol", async () => {
    await withProject({ files }, async ({ viteUrl, root, get }) => {
      const hello = await (await fetch(new URL("__caliper/hello", viteUrl))).json()
      expect(hello).toEqual({ protocol: PROTOCOL, id: projectId(root), name: "fixture-app", root })
      const write = await fetch(new URL("__caliper/host", viteUrl), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target: "store", method: "list", args: [] }) })
      expect(write.status).toBe(401)
      // Reads stay open, as Vite's modules are.
      expect((await get("/__caliper/project.json")).status).toBe(200)
    })
  })

  test("its host endpoint runs only listed calls, inside the store's fence", async () => {
    await withProject({ files }, async ({ viteUrl, root }) => {
      const token = registered(root).token
      /** @param {string} target @param {string} method @param {unknown[]} args */
      const call = async (target, method, args) => (await fetch(new URL("__caliper/host", viteUrl), {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ target, method, args: encode(args) }),
      })).json()
      const take = (await call("store", "create", [{ part: "src/Chip.part.tsx", state: "default", device: "rg353m", prompt: "p" }])).value
      expect(take).toBe("1")
      expect((await call("store", "write", [take, "src/Chip.part.tsx", "changed"])).value).toBe("src/Chip.part.tsx")
      for (const escape of ["../outside.txt", "/etc/passwd"]) expect((await call("store", "write", [take, escape, "x"])).error).toBeString()
      mkdirSync(join(root, "src/linked"), { recursive: true })
      const outside = mkdtempSync(join(tmpdir(), "caliper-outside-"))
      symlinkSync(outside, join(root, "src/linked/out"), "dir")
      expect((await call("store", "write", [take, "src/linked/out/escape.txt", "x"])).error).toBeString()
      expect(existsSync(join(outside, "escape.txt"))).toBe(false)
      expect((await call("store", "root", [])).error).toContain("no call")
      expect((await call("fs", "readFileSync", ["/etc/passwd"])).error).toContain("no call")
      const overview = (await call("store", "overview", [])).value
      expect(overview.takes).toEqual([{ take: "1", record: expect.any(Object), files: ["src/Chip.part.tsx"] }])
    })
  })
})

describe("the Caliper app", () => {
  test("answers takes from its own agent, and refuses writes from another site's page", async () => {
    await withProject({ files }, async ({ get, url }) => {
      const takes = await (await get("/__caliper/takes.json")).json()
      expect(takes.agent._tag).toBe("Off")
      expect(takes.agent.hint).toContain("~/.config/caliper/config.json")
      const foreign = await fetch(new URL("__caliper/takes", url), { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" })
      expect(foreign.status).toBe(403)
      const projects = await (await fetch(new URL("/__caliper/api/projects", url))).json()
      expect(projects.projects.map((/** @type {{ status: string }} */ project) => project.status)).toEqual(["Ready"])
      // A request with no project, as a hard reload sends, reaches no project.
      expect((await fetch(new URL("/src/Chip.part.tsx", url))).status).toBe(404)
    })
  })

  test("reads its settings file strictly and never takes a key from it", () => {
    const dir = mkdtempSync(join(tmpdir(), "caliper-settings-"))
    expect(readSettings(join(dir, "missing.json"))).toEqual({})
    writeFileSync(join(dir, "ok.json"), JSON.stringify({ agent: { model: "m", reasoning: "low" } }))
    expect(readSettings(join(dir, "ok.json"))).toEqual({ agent: { model: "m", reasoning: "low" } })
    writeFileSync(join(dir, "key.json"), JSON.stringify({ agent: { model: "m", apiKey: "secret" } }))
    expect(() => readSettings(join(dir, "key.json"))).toThrow("apiKey")
    writeFileSync(join(dir, "extra.json"), JSON.stringify({ agents: {} }))
    expect(() => readSettings(join(dir, "extra.json"))).toThrow("agents")
  })
})

describe("the proxy", () => {
  test("connects to a dev server on an IPv6 address without its brackets", () => {
    expect(socketHost(new URL("http://[::1]:5173/"))).toBe("::1")
    expect(socketHost(new URL("http://127.0.0.1:5173/"))).toBe("127.0.0.1")
  })
})

describe("the host wire", () => {
  test("keeps bytes, sets and maps", () => {
    const value = { bytes: Buffer.from("png"), ids: new Set(["a"]), map: new Map([["k", 1]]), list: [undefined, 1] }
    const back = decode(JSON.parse(JSON.stringify(encode(value))))
    expect(Buffer.isBuffer(back.bytes) && back.bytes.toString()).toBe("png")
    expect(back.ids).toEqual(new Set(["a"]))
    expect(back.map).toEqual(new Map([["k", 1]]))
  })
})
