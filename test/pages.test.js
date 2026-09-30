// @ts-check
import { describe, expect, test } from "bun:test"
import { caliper } from "../src/plugin.js"
import { chromeDelivery } from "../src/build/chrome.js"
import { manifest, withProject } from "./project-server.js"

const files = {
  "package.json": manifest(),
  "src/index.ts": 'import "./app.css"\nexport { mount } from "./mount"\n',
  "src/mount.tsx": 'import { createRoot } from "react-dom/client"\nexport const mount = (el: HTMLElement) => createRoot(el).render(<div className="shell" />)\n',
  "src/app.css": ".shell { width: 100% }\n",
  "src/Chip.part.tsx": "export default function Part() { return <span>chip</span> }\nexport const Empty = () => <span />\n",
}

/** @param {string} html */
function frameConfig(html) {
  const json = html.match(/<script type="application\/json" id="caliper-frame-config">(.*?)<\/script>/s)?.[1]
  if (json === undefined) throw new Error("The frame page has no config")
  return JSON.parse(json)
}

describe("the plugin", () => {
  test("runs only under the dev server", () => {
    expect(caliper().apply).toBe("serve")
  })

  test("closing Vite cancels a pending source refresh before the project is removed", async () => {
    await withProject({ files }, async ({ project, write }) => {
      await project()
      write("src/Chip.part.tsx", `${files["src/Chip.part.tsx"]}\nexport function Added() { return null }`)
      // Let the watcher enqueue its 80ms refresh, then close and remove the root.
      await new Promise(resolve => setTimeout(resolve, 30))
    })
    // A leaked refresh rejects after the root is gone and fails this test.
    await new Promise(resolve => setTimeout(resolve, 160))
  })
})

describe("the chrome page", () => {
  test("is served at /__caliper/ and loads no Vite client", async () => {
    await withProject({ files }, async ({ get }) => {
      const response = await get("/__caliper/")
      expect(response.status).toBe(200)
      const html = await response.text()
      expect(html).toContain(`/__caliper/assets/${chromeDelivery().entry}`)
      expect(html).not.toContain("/__caliper/client/chrome.js")
      expect(html).not.toContain("importmap")
      expect(html).not.toContain("/@vite/client")
    })
  })

  test("installs only the Caliper path, with the old display fallback and every icon", async () => {
    await withProject({ files: { ...files, "public/manifest.webmanifest": '{"name":"Product"}', "public/icon-192.png": "product-icon" } }, async ({ get }) => {
      const html = await (await get("/__caliper/")).text()
      expect(html).toContain('name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"')
      expect(html).toContain('rel="manifest" href="/__caliper/manifest.webmanifest"')
      expect(html).toContain('rel="apple-touch-icon" sizes="180x180" href="/__caliper/apple-touch-icon.png"')
      expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"')
      expect(html).toContain('name="theme-color" content="#16171a"')
      const response = await get("/__caliper/manifest.webmanifest")
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toContain("application/manifest+json")
      expect(response.headers.get("cache-control")).toBe("no-store")
      const manifest = await response.json()
      expect(manifest).toMatchObject({
        name: "Caliper", start_url: "./", scope: "./", display: "fullscreen",
        display_override: ["fullscreen", "standalone", "minimal-ui"], orientation: "any",
      })
      expect(new URL(manifest.start_url, response.url).pathname).toBe("/__caliper/")
      expect(new URL(manifest.scope, response.url).pathname).toBe("/__caliper/")
      for (const icon of manifest.icons) {
        expect(new URL(icon.src, response.url).pathname).toStartWith("/__caliper/")
        const image = await get(new URL(icon.src, response.url).pathname)
        expect(image.status).toBe(200)
        expect(image.headers.get("content-type")).toBe("image/png")
        const bytes = Buffer.from(await image.arrayBuffer())
        expect(bytes.subarray(1, 4).toString()).toBe("PNG")
        expect(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`).toBe(icon.sizes)
      }
      expect(await (await get("/manifest.webmanifest")).json()).toEqual({ name: "Product" })
      expect(await (await get("/icon-192.png")).text()).toBe("product-icon")
      expect((await get("/__caliper/icon-missing.png")).status).toBe(404)
    })
  })

  test("keeps install URLs beneath Vite's base path", async () => {
    await withProject({ files, base: "/preview/" }, async ({ get, url }) => {
      const pageResponse = await get("/__caliper/")
      expect(pageResponse.status).toBe(200)
      const html = await pageResponse.text()
      expect(html).toContain('rel="manifest" href="/preview/__caliper/manifest.webmanifest"')
      expect(html).toContain(`src="/preview/__caliper/assets/${chromeDelivery().entry}"`)
      const response = await get("/__caliper/manifest.webmanifest")
      expect(response.status).toBe(200)
      const manifest = await response.json()
      expect(new URL(manifest.start_url, response.url).pathname).toBe("/preview/__caliper/")
      expect(new URL(manifest.icons[0].src, response.url).pathname).toBe("/preview/__caliper/icon-192.png")
      expect((await fetch(new URL("/preview/__caliper/icon-192.png", url))).status).toBe(200)
    })
  })

  test("/__caliper redirects to /__caliper/", async () => {
    await withProject({ files }, async ({ url }) => {
      const response = await fetch(new URL("__caliper", url), { redirect: "manual" })
      expect(response.status).toBe(302)
      expect(response.headers.get("location")).toBe("/__caliper/")
    })
  })

  test("serves bundled chrome artifacts and only the product-frame client files", async () => {
    await withProject({ files }, async ({ get }) => {
      const delivery = chromeDelivery()
      const entry = await get(`/__caliper/assets/${delivery.entry}`)
      expect(entry.status).toBe(200)
      expect(entry.headers.get("content-type")).toContain("text/javascript")
      const artifact = delivery.read(delivery.entry)
      if (artifact === null) throw new Error("The built manifest entry must be readable")
      expect(await entry.text()).toBe(artifact.body.toString())
      for (const css of delivery.css) {
        const stylesheet = await get(`/__caliper/assets/${css}`)
        expect(stylesheet.status).toBe(200)
        expect(stylesheet.headers.get("content-type")).toContain("text/css")
      }
      expect((await get("/__caliper/client/frame.js")).status).toBe(200)
      expect((await get("/__caliper/client/frame.css")).status).toBe(200)
      expect((await get("/__caliper/client/chrome.js")).status).toBe(404)
      expect((await get("/__caliper/client/device-frame.js")).status).toBe(404)
      expect((await get("/__caliper/assets/.vite/manifest.json")).status).toBe(404)
      expect((await get("/__caliper/assets/../plugin.js")).status).toBe(404)
      expect((await get("/__caliper/client/../plugin.js")).status).toBe(404)
      expect((await get("/__caliper/client/types.d.ts")).status).toBe(404)
    })
  })
})

describe("the frame page", () => {
  test("loads the global CSS, the project's React and the part, inside the wrapper", async () => {
    await withProject({ files }, async ({ get }) => {
      const response = await get("/__caliper/frame?part=src/Chip.part.tsx")
      expect(response.status).toBe(200)
      const html = await response.text()
      expect(html).toContain("/@vite/client")
      expect(frameConfig(html)).toEqual({
        part: "/src/Chip.part.tsx",
        partFile: "src/Chip.part.tsx",
        state: "default",
        css: ["/src/app.css"],
        warnings: [],
        wrapper: [{ tag: "div", className: "shell" }],
        react: "/@id/__x00__caliper:react",
        problem: null,
      })
    })
  })

  test("renders the state the URL names", async () => {
    await withProject({ files }, async ({ get }) => {
      const response = await get("/__caliper/frame?part=src/Chip.part.tsx&state=Empty")
      expect(response.status).toBe(200)
      expect(frameConfig(await response.text())).toMatchObject({ state: "Empty", problem: null })
    })
  })

  test("names the problem when the state is unknown", async () => {
    await withProject({ files }, async ({ get }) => {
      const response = await get("/__caliper/frame?part=src/Chip.part.tsx&state=Busy")
      expect(response.status).toBe(404)
      expect(frameConfig(await response.text()).problem).toBe(
        'src/Chip.part.tsx has no state "Busy". Its states are: default, Empty.',
      )
    })
  })

  test("names the problem when the part is unknown", async () => {
    await withProject({ files }, async ({ get }) => {
      const response = await get("/__caliper/frame?part=src/Nope.part.tsx")
      expect(response.status).toBe(404)
      expect(frameConfig(await response.text()).problem).toContain('"src/Nope.part.tsx" is not a part of fixture-app')
    })
  })

  test("carries a watchdog, so a frame whose script never runs is not left blank", async () => {
    await withProject({ files }, async ({ get }) => {
      const html = await (await get("/__caliper/frame?part=src/Chip.part.tsx")).text()
      expect(html).toContain("did not start within")
    })
  })
})

describe("the event stream", () => {
  test("sends the project at once", async () => {
    await withProject({ files }, async ({ get }) => {
      const response = await get("/__caliper/events")
      expect(response.headers.get("content-type")).toContain("text/event-stream")
      const reader = /** @type {ReadableStream<Uint8Array>} */ (response.body).getReader()
      const decoder = new TextDecoder()
      let text = ""
      try {
        // HTTP chunks can split an event or contain both initial events.
        while (!text.includes("\n\n")) {
          const { value, done } = await reader.read()
          if (done) throw new Error("The project event did not finish")
          text += decoder.decode(value, { stream: true })
        }
        const event = text.split("\n\n")[0] ?? ""
        expect(event).toStartWith("event: project\ndata: ")
        expect(JSON.parse(event.slice("event: project\ndata: ".length)).parts[0].file).toBe("src/Chip.part.tsx")
      } finally {
        await reader.cancel()
      }
    })
  })
})
