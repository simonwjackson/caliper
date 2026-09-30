// @ts-check
// Node 24 strips the frozen contract module directly.
// @ts-ignore -- explicit extension is required by the Node browser-script runtime
import { CAL, calSelector } from "../src/client/ui/hooks.ts"

/** Shared CAL selectors. No UI class or region hierarchy is a behavioral API. */
export const cal = /** @type {Readonly<{ [K in keyof typeof CAL]: string }>} */ (Object.freeze(Object.fromEntries(Object.entries(CAL).map(([key, hook]) => [key, calSelector(hook)]))))

/**
 * Open native disclosures from outside in using their normal browser controls.
 * This proves reference-renderer reachability, not production overflow/layout.
 * @param {import("playwright-core").Page} page
 * @param {import("playwright-core").Locator} control
 * @returns {Promise<import("playwright-core").Locator>}
 */
export async function reveal(page, control) {
  await control.waitFor({ state: "attached" })
  const summaries = await control.evaluate(node => {
    const details = []
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement && !parent.open) {
        const summary = parent.querySelector(":scope > summary")
        if (summary) details.unshift(summary.textContent ?? "")
      }
    }
    return details
  })
  for (const name of summaries) await page.locator("summary").filter({ hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).first().click()
  await control.scrollIntoViewIfNeeded()
  return control
}

/**
 * Read readiness from the product document, never a figure's presentation.
 * Also verify the loaded document identity: an old document can survive a src change.
 * @param {import("playwright-core").Page} page
 * @param {number} count
 * @param {"Rendered" | "settled" | "Failed"} [verdict]
 */
export async function waitFrames(page, count, verdict = "Rendered") {
  await page.waitForFunction(({ selector, count, verdict }) => {
    const frames = [...document.querySelectorAll(selector)]
    return frames.length === count && frames.every(node => {
      const frame = /** @type {HTMLIFrameElement} */ (node)
      const doc = frame.contentDocument
      const query = new URLSearchParams(doc?.location.search ?? "")
      const state = doc?.documentElement?.dataset.caliperState
      return query.get("part") === frame.dataset.part && (query.get("state") ?? "default") === frame.dataset.state
        && (query.get("take") ?? null) === (frame.dataset.take ?? null)
        && (verdict === "settled" ? ["Rendered", "Empty", "Failed"].includes(state ?? "") : state === verdict)
    })
  }, { selector: cal.frame, count, verdict }, { timeout: 30_000 })
}

/** Exact reference-only layout limits, printed rather than passed as assertions.
 * @param {string[]} gates
 */
export function deferLayout(gates) {
  for (const gate of gates) console.warn(`DEFERRED / NOT PROVEN (unstyled reference): ${gate}`)
}

/** Wait on the authoritative server run, while UI actions and logs remain browser-tested.
 * @param {string} base
 * @param {string[]} ids
 * @param {number} [timeout]
 */
export async function waitTakes(base, ids, timeout = 60_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    /** @type {import("../src/types").TakesSnapshot} */
    const snapshot = await (await fetch(new URL("takes.json", base))).json()
    const takes = ids.map(id => snapshot.takes.find(take => take.take === id))
    if (takes.every(take => take && take.run._tag !== "Running")) return takes.map(take => {
      if (!take) throw new Error("Take disappeared")
      return take
    })
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Takes did not finish: ${ids.join(", ")}`)
}
