// @ts-check
import { expect, test } from "bun:test"
import { resolve } from "node:path"
import { mergeConfig, version } from "vite"
import { caliper } from "../src/plugin.js"
import { createTakeStore } from "../src/takes/store.js"
import { openBrowserSession } from "../src/render/browser-session.js"
import { manifest, withProject } from "./project-server.js"

// Vite retries unresolved modules on file creation. Generated evidence must
// not turn that retry into HMR for a frame whose product source did not change.
test.skipIf(!process.env.CHROMIUM)("generated check evidence does not reload frames; product saves still do", async () => {
  const healthy = "src/Healthy.part.tsx"
  const component = (/** @type {string} */ text) => `import React from 'react'; export default () => <button>${text}</button>`
  await withProject({ modules: resolve(process.env.CALIPER_TEST_MODULES ?? "node_modules"), files: {
    "package.json": manifest(), "src/index.ts": "export {}",
    [healthy]: component("Healthy"),
    "src/Broken.part.tsx": "import './Missing'; export default () => null",
  } }, async f => {
    const custom = /private-output/
    const options = { root: f.root, server: { watch: { ignored: custom } } }
    const hook = /** @type {import('vite').Plugin} */ (/** @type {unknown} */ (caliper())).config
    if (typeof hook !== "function") throw new Error("Expected a configuration hook")
    const configured = await hook.call(/** @type {any} */ ({ meta: { viteVersion: version } }), options, { command: "serve", mode: "development" })
    const merged = mergeConfig(options, configured ?? {})
    expect(merged.server.watch.ignored).toContain(custom)
    expect(merged.server.watch.ignored).toContain("**/.caliper/checks/**")
    const session = await openBrowserSession(/** @type {string} */ (process.env.CHROMIUM))
    try {
      const context = await session.browser.newContext()
      const page = await context.newPage()
      let navigations = 0
      page.on("framenavigated", frame => { if (frame === page.mainFrame()) navigations++ })
      await page.goto(new URL(`__caliper/frame?part=${healthy}`, f.viteUrl).href)
      await page.getByRole("button", { name: "Healthy", exact: true }).waitFor()
      expect((await f.get("/src/Broken.part.tsx")).status).toBe(500)
      const before = navigations
      for (let index = 0; index < 3; index++) {
        f.write(`.caliper/checks/run/sample-${index}.png`, "generated evidence")
        // Allow the real filesystem watcher and HMR socket to deliver an update.
        await new Promise(resolve => setTimeout(resolve, 250))
      }
      expect(navigations).toBe(before)
      f.write(healthy, component("Edited"))
      await page.getByRole("button", { name: "Edited", exact: true }).waitFor()
      expect(navigations).toBeGreaterThan(before)
      await page.close()
      const store = createTakeStore(f.root)
      const take = store.create({ part: healthy, state: "default", device: "iphone-16" })
      store.write(take, healthy, component("Taken"))
      const takenPage = await context.newPage()
      takenPage.on("framenavigated", frame => { if (frame === takenPage.mainFrame()) navigations++ })
      await takenPage.goto(new URL(`__caliper/frame?part=${healthy}&take=${take}`, f.viteUrl).href, { waitUntil: "commit" })
      await takenPage.getByRole("button", { name: "Taken", exact: true }).waitFor()
      const beforeTake = navigations
      store.write(take, healthy, component("Take edited"))
      await takenPage.getByRole("button", { name: "Take edited", exact: true }).waitFor()
      expect(navigations).toBeGreaterThan(beforeTake)
    } finally { await session.close() }
  })
}, 30000)
