// @ts-check
// Node 24 strips the frozen contract module directly.
// @ts-ignore -- explicit extension is required by the Node browser-script runtime
import { CAL, calSelector } from "../src/client/ui/hooks.ts"

/** Shared CAL selectors. No UI class or region hierarchy is a behavioral API. */
export const cal = /** @type {Readonly<{ [K in keyof typeof CAL]: string }>} */ (Object.freeze(Object.fromEntries(Object.entries(CAL).map(([key, hook]) => [key, calSelector(hook)]))))

/**
 * Bring a control into reach the way a person would, one tap at a time, and
 * return it. In the Darkroom chrome a control can sit behind one tap: in the
 * parts drawer, in the More tools menu, or on a sheet that another sheet
 * covers. Each step is a normal click on a visible control. A control that no
 * step reaches fails the gate: nothing may become unreachable (decision 22).
 *
 * The reference renderer keeps its native <details> path below.
 * @param {import("playwright-core").Page} page
 * @param {import("playwright-core").Locator} control
 * @returns {Promise<import("playwright-core").Locator>}
 */
export async function reveal(page, control) {
  if (await page.locator(".dr-root").count()) return revealDarkroom(page, control)
  return revealReference(page, control)
}

/** @param {import("playwright-core").Page} page */
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

/**
 * @param {import("playwright-core").Page} page
 * @param {import("playwright-core").Locator} control
 */
async function revealDarkroom(page, control) {
  const root = page.locator(".dr-root")
  const tried = new Set()
  for (let step = 0; step < 6; step++) {
    await settle(page)
    const target = control.first()
    if (await target.isVisible()) {
      await target.scrollIntoViewIfNeeded()
      return target
    }
    const attached = await target.count() > 0
    const where = attached ? await target.evaluate(node => ({
      nav: node.closest(".dr-parts, .dr-parts__panel, [data-cal=\"parts\"]") !== null,
      side: node.closest(".dr-side")?.hasAttribute("hidden") ?? false,
      sideKind: node.closest(".dr-side")?.querySelector("[data-cal=\"knobs\"]") ? "knobs" : "takes",
      code: node.closest(".dr-code")?.hasAttribute("hidden") ?? false,
      bar: node.closest(".dr-bar")?.hasAttribute("hidden") ?? false,
      menu: node.closest("[role=menu]") !== null,
    })) : null
    const drawerOpen = await root.getAttribute("data-drawer") === "open"
    /** @type {import("playwright-core").Locator | null} */
    let tap = null
    if (!attached || where?.nav) {
      // A missing control is most often in the closed parts drawer or column.
      const parts = page.locator(`${cal.navToggle}[aria-expanded="false"]`)
      if (!tried.has("parts") && await parts.count()) { tap = parts.first(); tried.add("parts") }
      else if (!tried.has("more")) { tap = page.getByRole("button", { name: "More tools" }); tried.add("more") }
    } else if (drawerOpen) {
      await page.keyboard.press("Escape"); continue
    } else if (where?.side) tap = page.locator(`${cal.tool}[data-tool="${where.sideKind}"]`)
    else if (where?.code) tap = page.locator(`${cal.tool}[data-tool="code"]`)
    else if (where?.bar) tap = page.locator(`${cal.tool}[data-tool="preview"]`)
    if (tap && !(await tap.first().isVisible()) && !tried.has("more")) { tried.add("more"); tap = page.getByRole("button", { name: "More tools" }) }
    if (!tap || !(await tap.first().isVisible())) break
    await tap.first().click()
  }
  await control.first().waitFor({ state: "visible", timeout: 2_000 })
  await control.first().scrollIntoViewIfNeeded()
  return control.first()
}

/**
 * Open native disclosures from outside in using their normal browser controls.
 * This proves reference-renderer reachability, not production overflow/layout.
 * @param {import("playwright-core").Page} page
 * @param {import("playwright-core").Locator} control
 * @returns {Promise<import("playwright-core").Locator>}
 */
async function revealReference(page, control) {
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
