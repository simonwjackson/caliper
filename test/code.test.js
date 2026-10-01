// @ts-check
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { gunzipSync } from "node:zlib"
import { codeChange } from "../src/code/api.js"
import { chromeDelivery } from "../src/build/chrome.js"
import { browserPackages, CHROME_PACKAGES, importMap, serveModule } from "../src/code/modules.js"
import { createTakeStore } from "../src/takes/store.js"
import { manifest, withProject } from "./project-server.js"

const CALIPER = fileURLToPath(new URL("../", import.meta.url))

const files = {
  "package.json": manifest(),
  "src/index.ts": 'import "./app.css"\n',
  "src/app.css": "body { margin: 0 }\n",
  "src/ui/Chip.tsx": 'import "./Chip.css"\nimport { Dot } from "./Dot"\nexport function Chip() { return <span className="chip"><Dot /></span> }\n',
  "src/ui/Chip.css": ".chip { color: blue }\n",
  "src/ui/Dot.tsx": "export function Dot() { return <i /> }\n",
  "src/ui/Chip.part.tsx": 'import { Chip } from "./Chip"\nexport default function Part() { return <Chip /> }\nexport const Empty = () => null\n',
  "src/unused.css": ".unused {}\n",
}

/**
 * @param {string} url
 * @param {string} path
 * @param {unknown} body
 */
function post(url, path, body) {
  return fetch(new URL(path.replace(/^\//, ""), url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

/**
 * A take of the Chip part with one file edited by hand, as the code pane saves it.
 *
 * @param {string} root
 * @param {string} url
 * @param {string} file
 * @param {string} content
 */
async function takeWith(root, url, file, content) {
  const take = createTakeStore(root).create({ part: "src/ui/Chip.part.tsx", state: "default", device: "iphone-16" })
  const saved = await post(url, `/__caliper/takes/${take}/file`, { file, content })
  expect(saved.status).toBe(200)
  return take
}

describe("the chrome's browser packages", () => {
  test("every package the chrome imports resolves from Caliper's node_modules, once", () => {
    const { packages, problems } = browserPackages(CALIPER, CHROME_PACKAGES)
    expect(problems).toEqual([])
    const names = packages.map(pkg => pkg.name)
    for (const name of CHROME_PACKAGES) expect(names).toContain(name)
    expect(new Set(names).size).toBe(names.length)
    for (const pkg of packages) expect(existsSync(join(pkg.dir, pkg.entry))).toBe(true)
    const map = importMap(packages, "/__caliper/modules")
    const view = packages.find(pkg => pkg.name === "@codemirror/view")
    expect(map.imports["@codemirror/view"]).toBe(`/__caliper/modules/@codemirror/view@${view?.version}/${view?.entry}`)
  })

  test("serves only JavaScript inside a known package, compressed when asked", () => {
    const { packages } = browserPackages(CALIPER, ["@codemirror/state"])
    const state = /** @type {import("../src/code/modules.js").BrowserPackage} */ (packages.find(pkg => pkg.name === "@codemirror/state"))
    const path = `${state.name}@${state.version}/${state.entry}`
    const cache = new Map()
    const plain = serveModule(packages, path, false, cache)
    const gzip = serveModule(packages, path, true, cache)
    expect(plain?.encoding).toBeNull()
    expect(gzip?.encoding).toBe("gzip")
    expect(gunzipSync(/** @type {Buffer} */ (gzip?.body)).equals(/** @type {Buffer} */ (plain?.body))).toBe(true)
    expect(serveModule(packages, `${state.name}@${state.version}/../../../package.json`, false, cache)).toBeNull()
    expect(serveModule(packages, `${state.name}@${state.version}/package.json`, false, cache)).toBeNull()
    expect(serveModule(packages, `${state.name}@0.0.0/${state.entry}`, false, cache)).toBeNull()
  })

  test("names two versions of one package, and a missing package", () => {
    const root = mkdtempSync(join(tmpdir(), "caliper-packages-"))
    try {
      /** @param {string} dir @param {object} json */
      const pkg = (dir, json) => {
        mkdirSync(join(root, dir), { recursive: true })
        writeFileSync(join(root, dir, "package.json"), JSON.stringify(json))
        writeFileSync(join(root, dir, "index.js"), "export {}\n")
      }
      pkg("node_modules/a", { name: "a", version: "1.0.0", exports: { import: "./index.js" }, dependencies: { b: "2" } })
      pkg("node_modules/a/node_modules/b", { name: "b", version: "2.0.0", exports: { import: "./index.js" } })
      pkg("node_modules/b", { name: "b", version: "1.0.0", exports: { import: "./index.js" } })
      pkg("node_modules/c", { name: "c", version: "1.0.0", main: "index.js", dependencies: { gone: "1" } })
      const { problems } = browserPackages(root, ["a", "b", "c"])
      expect(problems).toEqual([
        "Caliper found two versions of b: 2.0.0 and 1.0.0. The code editor needs exactly one.",
        "c 1.0.0 has no ES module entry Caliper can load in a browser.",
      ])
      expect(browserPackages(root, ["missing"]).problems[0]).toContain("cannot find the package missing")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("codeChange", () => {
  const root = "/project"
  test("names a real file, a take's copy, and nothing else", () => {
    expect(codeChange(root, "/project/src/a.css")).toEqual({ file: "src/a.css", take: null })
    expect(codeChange(root, "/project/.caliper/takes/3/src/a.css")).toEqual({ file: "src/a.css", take: "3" })
    expect(codeChange(root, "/project/.caliper/takes/3.json")).toBeNull()
    expect(codeChange(root, "/project/.caliper/.gitignore")).toBeNull()
    expect(codeChange(root, "/project/node_modules/x/index.js")).toBeNull()
    expect(codeChange(root, "/elsewhere/a.css")).toBeNull()
  })
})

describe("the code API", () => {
  test("the chrome serves Caliper's bundled editor as a lazy resource, without an import map", async () => {
    const delivery = chromeDelivery()
    /** @type {Record<string, {file: string, isDynamicEntry?: boolean, imports?: string[]}>} */
    const manifest = JSON.parse(readFileSync(join(CALIPER, "dist/chrome/.vite/manifest.json"), "utf8"))
    const editor = manifest["src/client/code-editor.js"]
    expect(editor?.isDynamicEntry).toBe(true)
    const entry = Object.keys(manifest).find(key => manifest[key]?.file === delivery.entry)
    const eager = new Set(entry ? [entry] : [])
    for (const key of eager) for (const imported of manifest[key]?.imports ?? []) eager.add(imported)
    expect(eager.has("src/client/code-editor.js")).toBe(false)
    await withProject({ files }, async ({ get, url: base }) => {
      const html = await (await get("/__caliper/")).text()
      expect(html).toContain(`"/__caliper/assets/${delivery.entry}"`)
      expect(html).not.toContain("importmap")
      expect(html).not.toContain(editor?.file ?? "missing editor")
      const response = await fetch(new URL(`/__caliper/assets/${editor?.file}`, base))
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toContain("text/javascript")
      expect(response.headers.get("cache-control")).toBe("no-store")
      const served = delivery.read(editor?.file ?? "")
      if (!served) throw new Error("The editor is not in Caliper's build resources")
      expect(Buffer.from(await response.arrayBuffer()).equals(served.body)).toBe(true)
    })
  })

  test("serves every manifest resource, not legacy chrome sources or package module paths", async () => {
    /** @type {Record<string, {file: string, css?: string[], assets?: string[], imports?: string[], dynamicImports?: string[]}>} */
    const manifest = JSON.parse(readFileSync(join(CALIPER, "dist/chrome/.vite/manifest.json"), "utf8"))
    const resources = new Set(Object.values(manifest).flatMap(chunk => [chunk.file, ...(chunk.css ?? []), ...(chunk.assets ?? [])]))
    for (const chunk of Object.values(manifest)) for (const key of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])]) expect(manifest[key]).toBeDefined()
    await withProject({ files }, async ({ get, url }) => {
      for (const name of resources) {
        const response = await fetch(new URL(`/__caliper/assets/${name}`, url))
        expect({ name, status: response.status }).toEqual({ name, status: 200 })
        expect(Buffer.from(await response.arrayBuffer()).equals(readFileSync(join(CALIPER, "dist/chrome", name)))).toBe(true)
      }
      for (const path of ["/__caliper/client/chrome.js", "/__caliper/client/code-editor.js", "/__caliper/modules/@codemirror/view@6.43.13/dist/index.js"]) expect((await get(path)).status).toBe(404)
      expect((await fetch(new URL("/__caliper/assets/.vite/manifest.json", url))).status).toBe(404)
      // Only the product-frame bootstrap still uses the consumer's Vite.
      expect((await get("/__caliper/client/frame.js")).status).toBe(200)
    })
  })

  test("lists the files a part is made of, nearest first", async () => {
    await withProject({ files }, async ({ get }) => {
      const { files: listed } = await (await get("/__caliper/code/files?part=src/ui/Chip.part.tsx")).json()
      expect(listed).toEqual([
        { file: "src/ui/Chip.part.tsx", depth: 0, changed: false },
        { file: "src/ui/Chip.tsx", depth: 1, changed: false },
        { file: "src/ui/Chip.css", depth: 2, changed: false },
        { file: "src/ui/Dot.tsx", depth: 2, changed: false },
      ])
      expect((await get("/__caliper/code/files?part=src/nope.part.tsx")).status).toBe(404)
    })
  })

  test("a take's list follows the take's imports and shows changes the part does not reach", async () => {
    await withProject({ files }, async ({ get, url, root }) => {
      const take = await takeWith(root, url, "src/ui/Chip.tsx", 'import "./Chip.css"\nexport function Chip() { return <span className="chip" /> }\n')
      const snapshot = await (await get("/__caliper/takes.json")).json()
      expect(snapshot.takes.find((/** @type {any} */ view) => view.take === take)).toMatchObject({ files: ["src/ui/Chip.tsx"], run: { _tag: "Idle" }, log: [{ _tag: "Edit", file: "src/ui/Chip.tsx" }] })
      await post(url, `/__caliper/takes/${take}/file`, { file: "src/unused.css", content: ".unused { color: red }\n" })
      const { files: listed } = await (await get(`/__caliper/code/files?part=src/ui/Chip.part.tsx&take=${take}`)).json()
      expect(listed).toEqual([
        { file: "src/ui/Chip.part.tsx", depth: 0, changed: false },
        { file: "src/ui/Chip.tsx", depth: 1, changed: true },
        { file: "src/ui/Chip.css", depth: 2, changed: false },
        { file: "src/unused.css", depth: null, changed: true },
      ])
    })
  })

  test("opens a file as the take sees it, with the real file to compare", async () => {
    await withProject({ files }, async ({ get, url, root }) => {
      const take = await takeWith(root, url, "src/ui/Chip.css", ".chip { color: red }\n")
      await post(url, `/__caliper/takes/${take}/file`, { file: "src/ui/New.css", content: ".new {}\n" })
      expect(await (await get("/__caliper/code/file?file=src/ui/Chip.css")).json()).toEqual({ file: "src/ui/Chip.css", content: ".chip { color: blue }\n" })
      expect(await (await get(`/__caliper/code/file?file=src/ui/Chip.css&take=${take}`)).json()).toEqual({
        file: "src/ui/Chip.css", content: ".chip { color: red }\n", original: ".chip { color: blue }\n",
      })
      expect(await (await get(`/__caliper/code/file?file=src/ui/New.css&take=${take}`)).json()).toMatchObject({ original: null })
      expect((await get("/__caliper/code/file?file=.env")).status).toBe(404)
      expect((await get("/__caliper/code/file?file=../etc/passwd")).status).toBe(404)
      expect((await get("/__caliper/code/file?file=src/ui/Chip.css&take=99")).status).toBe(404)
    })
  })

  test("saving a take file back to the real content leaves the take with no changes", async () => {
    await withProject({ files }, async ({ get, url, root }) => {
      const take = await takeWith(root, url, "src/ui/Chip.css", ".chip { color: red }\n")
      const saved = await (await post(url, `/__caliper/takes/${take}/file`, { file: "src/ui/Chip.css", content: files["src/ui/Chip.css"] })).json()
      expect(saved).toEqual({ take, files: [] })
      expect(existsSync(join(root, ".caliper/takes", take, "src/ui/Chip.css"))).toBe(false)
      expect(readFileSync(join(root, "src/ui/Chip.css"), "utf8")).toBe(files["src/ui/Chip.css"])
      const snapshot = await (await get("/__caliper/takes.json")).json()
      expect(snapshot.takes.find((/** @type {any} */ view) => view.take === take).files).toEqual([])
    })
  })

  test("saves a real file, as any editor would, and makes no take", async () => {
    await withProject({ files }, async ({ get, url, root }) => {
      const saved = await post(url, "/__caliper/code/file", { file: "src/ui/Chip.css", content: ".chip { color: teal }\n" })
      expect(await saved.json()).toEqual({ file: "src/ui/Chip.css" })
      expect(readFileSync(join(root, "src/ui/Chip.css"), "utf8")).toBe(".chip { color: teal }\n")
      expect((await (await get("/__caliper/takes.json")).json()).takes).toEqual([])
    })
  })

  test("a real save needs the chrome's origin, and only overwrites a project file that exists", async () => {
    await withProject({ files: { ...files, ".env": "SECRET=1\n" }, git: true }, async ({ url, root }) => {
      const denied = await fetch(new URL("__caliper/code/file", url), {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example" },
        body: JSON.stringify({ file: "src/ui/Chip.css", content: "x" }),
      })
      expect(denied.status).toBe(403)
      await denied.arrayBuffer()
      /** @param {object} body */
      const error = async body => (await (await post(url, "/__caliper/code/file", body)).json()).error
      expect(await error({ content: "x" })).toBe("Name the file to save.")
      expect(await error({ file: ".env", content: "x" })).toContain("environment file")
      expect(await error({ file: "../outside.css", content: "x" })).toContain("outside the project")
      expect(await error({ file: "node_modules/x.js", content: "x" })).toContain("node_modules")
      expect(await error({ file: "src/ui/New.css", content: "x" })).toContain("saves only files that exist")
      expect(await error({ file: "src/ui", content: "x" })).toContain("saves only files that exist")
      expect(readFileSync(join(root, ".env"), "utf8")).toBe("SECRET=1\n")
      expect(readFileSync(join(root, "src/ui/Chip.css"), "utf8")).toBe(files["src/ui/Chip.css"])
      expect(existsSync(join(root, "src/ui/New.css"))).toBe(false)
    })
  })

  test("a take save needs a file inside the project", async () => {
    await withProject({ files }, async ({ url, root }) => {
      const take = await takeWith(root, url, "src/ui/Chip.css", ".chip { color: red }\n")
      expect((await (await post(url, `/__caliper/takes/${take}/file`, { content: "x" })).json()).error).toBe("Name the file to save.")
      expect((await (await post(url, `/__caliper/takes/${take}/file`, { file: "src/.env", content: "x" })).json()).error).toContain("environment file")
    })
  })

  test("the event stream says when a real file or a take's copy changes on disk", async () => {
    await withProject({ files }, async ({ get, url, write, root }) => {
      const take = await takeWith(root, url, "src/ui/Chip.css", ".chip { color: red }\n")
      const response = await get("/__caliper/events")
      const reader = /** @type {ReadableStreamDefaultReader<Uint8Array>} */ (response.body?.getReader())
      const decoder = new TextDecoder()
      let text = ""
      /** @param {string} wanted */
      const until = async wanted => {
        const deadline = Date.now() + 5000
        while (!text.includes(wanted)) {
          if (Date.now() > deadline) throw new Error(`No ${wanted} in:\n${text}`)
          const { value, done } = await reader.read()
          if (done) throw new Error("The stream ended")
          text += decoder.decode(value)
        }
      }
      await until("event: takes")
      write("src/ui/Chip.css", ".chip { color: green }\n")
      await until(`event: code\ndata: ${JSON.stringify({ file: "src/ui/Chip.css", take: null })}`)
      await post(url, `/__caliper/takes/${take}/file`, { file: "src/ui/Chip.css", content: ".chip { color: purple }\n" })
      await until(`event: code\ndata: ${JSON.stringify({ file: "src/ui/Chip.css", take })}`)
      await reader.cancel()
    })
  })
})
