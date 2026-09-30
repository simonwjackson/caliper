// @ts-check
import { describe, expect, test } from "bun:test"
import { chromePage } from "../src/pages.js"
import { chromeDelivery } from "../src/build/chrome.js"
import { caliper } from "../src/plugin.js"
import { withProject, manifest } from "./project-server.js"
import { TOOL_REVISION, verifiedToolDirectory } from "../src/build/tool.js"

const files = {
  "package.json": manifest(),
  "src/index.ts": "export {}\n",
  "src/Chip.part.tsx": "export default function Chip() { return <button>Chip</button> }\n",
}

describe("isolated chrome delivery", () => {
  test("has no legacy CSS, import map, or script when the bundle has no CSS", () => {
    const html = chromePage({ entryUrl: "/__caliper/assets/chrome.js", cssUrls: [], pwaUrl: "/__caliper", themeColor: "#16171a" })
    expect(html).toContain('src="/__caliper/assets/chrome.js"')
    expect(html).not.toContain("chrome.css")
    expect(html).not.toContain("/client/chrome.js")
    expect(html).not.toContain("importmap")
    expect(html).not.toContain("stylesheet")
  })

  test("uses only the bundle's declared stylesheets", () => {
    const html = chromePage({ entryUrl: "/preview/__caliper/assets/chrome.js", cssUrls: ["/preview/__caliper/assets/style.css"], pwaUrl: "/preview/__caliper", themeColor: "#16171a" })
    expect(html).toContain('href="/preview/__caliper/assets/style.css"')
    expect(html).not.toContain("/client/chrome.css")
  })

  test("does not give consumer Vite a chrome source or dependency resolution", async () => {
    const hook = /** @type {import('vite').Plugin} */ (/** @type {unknown} */ (caliper())).resolveId
    if (typeof hook !== "object" || hook === null) throw new Error("Expected ordered resolver")
    const context = { resolve: async () => null }
    for (const id of ["/__caliper/assets/chrome.js", "/__caliper/client/chrome.js", "/__caliper/client/code-editor.js", "@codemirror/state", "react-dom/client"]) {
      expect(await hook.handler.call(/** @type {any} */ (context), id, undefined, { isEntry: false, attributes: {} })).toBeNull()
    }
  })

  test("the app serves manifest-listed bundles; the project keeps frame routes under its Vite base", async () => {
    const delivery = chromeDelivery()
    await withProject({ files, base: "/preview/" }, async ({ get, url }) => {
      const app = (/** @type {string} */ path) => fetch(new URL(path, url))
      const html = await (await get("/__caliper/")).text()
      expect(html).toContain(`/__caliper/assets/${delivery.entry}`)
      expect(html).not.toContain("/@vite/client")
      const entry = await app(`/__caliper/assets/${delivery.entry}`)
      expect(entry.status).toBe(200)
      expect(entry.headers.get("content-type")).toContain("text/javascript")
      for (const path of ["/__caliper/assets/plugin.js", "/__caliper/assets/.vite/manifest.json"]) expect((await app(path)).status).toBe(404)
      for (const path of ["/__caliper/client/chrome.js", "/__caliper/modules/react@19/index.js"]) expect((await get(path)).status).toBe(404)
      expect(delivery.read("../src/plugin.js")).toBeNull()
      expect(delivery.read(".vite/manifest.json")).toBeNull()
      const frame = await (await get("/__caliper/frame?part=src/Chip.part.tsx")).text()
      expect(frame).toContain("/@vite/client")
      expect(frame).toContain('src="/preview/__caliper/client/frame.js"')
      expect(frame).toContain('href="/preview/__caliper/client/frame.css"')
      expect(frame).not.toContain("/preview/preview/")
      expect(frame).toContain("caliper:react")
      expect((await app("/__caliper/manifest.webmanifest")).status).toBe(200)
    })
  })

  test.skipIf(!process.env.CALIPER_TEST_TOOL)("uses a pinned independent tool installation", () => {
    const tool = verifiedToolDirectory()
    expect(tool).toEndWith(TOOL_REVISION)
    expect(tool).not.toContain(".worktree/core")
  })
})
