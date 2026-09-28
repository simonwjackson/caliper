// @ts-check
import { expect, test } from "bun:test"
import { manifest, withProject } from "./project-server.js"

const step = (/** @type {number} */ n) => `.box { --step: ${n}; }\n`
const sleep = (/** @type {number} */ ms) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Vite's watcher drops a save that comes within 50 ms of the last `change`
 * for the same file. The browser re-fetches the module after the first save,
 * so Vite caches that version and never learns about the second.
 */
test("a second save within 50 ms of the first still reaches Vite", async () => {
  await withProject({ files: { "package.json": manifest(), "src/index.ts": "", "src/a.css": step(0) } }, async ({ get, write }) => {
    /** The step Vite serves now, as the browser would fetch it. */
    const served = async () => Number((await (await get("/src/a.css")).text()).match(/--step: (\d+)/)?.[1] ?? -1)
    expect(await served()).toBe(0)
    for (let run = 1; run <= 5; run++) {
      const first = run * 2 - 1
      write("src/a.css", step(first))
      // Fetch as soon as Vite knows about the first save, as a frame does after HMR.
      const deadline = Date.now() + 2000
      while ((await served()) !== first && Date.now() < deadline) await sleep(2)
      expect(await served()).toBe(first)
      write("src/a.css", step(first + 1))
      await sleep(300)
      expect(await served()).toBe(first + 1)
    }
  })
}, 20000)
