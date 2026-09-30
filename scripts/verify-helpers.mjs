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
  // The Caliper app's chrome starts after its routing worker controls the page,
  // which can be after the page's load event (decision 37).
  await page.locator(cal.root).first().waitFor({ state: "attached", timeout: 30_000 })
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
    // A folded group, such as the passed checks, opens with its own summary.
    if (await target.count()) {
      const folded = await target.evaluate(node => {
        let count = 0
        for (let parent = node.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement && !parent.open && !(node.tagName === "SUMMARY" && node.parentElement === parent)) count++
        return count
      })
      for (let i = 0; i < folded; i++) {
        await target.evaluate(node => {
          /** @type {HTMLDetailsElement | null} */
          let outer = null
          for (let parent = node.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement && !parent.open && !(node.tagName === "SUMMARY" && node.parentElement === parent)) outer = parent
          outer?.setAttribute("data-reveal", "")
        })
        await page.locator("details[data-reveal] > summary").first().click()
        await page.locator("details[data-reveal]").evaluate(node => node.removeAttribute("data-reveal"))
      }
    }
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
      // A closed popover, such as a token list: its opener names it with aria-controls.
      popover: (() => { const pop = node.closest("[popover]"); return pop && !pop.matches(":popover-open") ? pop.id : null })(),
      popoverSide: node.closest("[popover]")?.closest(".dr-side")?.hasAttribute("hidden") ?? false,
    })) : null
    const drawerOpen = await root.getAttribute("data-drawer") === "open"
    /** @type {import("playwright-core").Locator | null} */
    let tap = null
    const opener = where?.popover && !where.popoverSide ? page.locator(`[aria-controls="${where.popover}"]`).first() : null
    if (opener && await opener.isVisible()) tap = opener
    else if (where?.nav) {
      // The parts panel is mounted but closed: its toggle opens the column or the drawer.
      const parts = page.locator(`${cal.navToggle}[aria-expanded="false"]`)
      if (await parts.count() && await parts.first().isVisible()) tap = parts.first()
      else if (!tried.has("more")) { tap = page.getByRole("button", { name: "More tools" }); tried.add("more") }
    } else if (!attached) {
      // A missing control sits in a closed menu: New take options, or More tools.
      if (drawerOpen) { await page.keyboard.press("Escape"); continue }
      const menu = page.getByRole("button", { name: "New take options" })
      if (!tried.has("new-take") && await menu.count() && await menu.first().isVisible() && await menu.first().getAttribute("aria-expanded") !== "true") { tap = menu.first(); tried.add("new-take") }
      else if (!tried.has("more")) {
        tried.add("more")
        if (await menu.first().getAttribute("aria-expanded").catch(() => null) === "true") await page.keyboard.press("Escape")
        tap = page.getByRole("button", { name: "More tools" })
      }
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
