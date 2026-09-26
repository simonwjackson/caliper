// @ts-check
import { describe, expect, test } from "bun:test"
import { caliper } from "../src/plugin.js"
import { manifest, withProject } from "./project-server.js"

const files = {
  "package.json": manifest(),
  "src/index.ts": 'import "./app.css"\nexport { mount } from "./mount"\n',
  "src/mount.tsx": 'import { createRoot } from "react-dom/client"\nexport const mount = (el: HTMLElement) => createRoot(el).render(<div className="shell" />)\n',
  "src/app.css": ".shell { width: 100% }\n",
  "src/Chip.part.tsx": "export default function Part() { return <span>chip</span> }\n",
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
})

describe("the chrome page", () => {
  test("is served at /__caliper/ and loads no Vite client", async () => {
    await withProject({ files }, async ({ get }) => {
      const response = await get("/__caliper/")
      expect(response.status).toBe(200)
      const html = await response.text()
      expect(html).toContain("/__caliper/client/chrome.js")
      expect(html).not.toContain("/@vite/client")
    })
  })

  test("/__caliper redirects to /__caliper/", async () => {
    await withProject({ files }, async ({ url }) => {
      const response = await fetch(new URL("__caliper", url), { redirect: "manual" })
      expect(response.status).toBe(302)
      expect(response.headers.get("location")).toBe("/__caliper/")
    })
  })

  test("serves its own client files and nothing else from its folder", async () => {
    await withProject({ files }, async ({ get }) => {
      expect((await get("/__caliper/client/chrome.js")).status).toBe(200)
      expect((await get("/__caliper/client/device-frame.js")).status).toBe(200)
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
        css: ["/src/app.css"],
        wrapper: [{ tag: "div", className: "shell" }],
        react: "/@id/__x00__caliper:react",
        problem: null,
      })
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
      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)
      expect(text).toStartWith("event: project\ndata: ")
      expect(JSON.parse(text.split("data: ")[1] ?? "").parts[0].file).toBe("src/Chip.part.tsx")
      await reader.cancel()
    })
  })
})
