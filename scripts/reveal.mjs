// @ts-check
/**
 * Bring a chrome control into reach the way a person would. At small sizes a
 * control can sit one tap away: in the part drawer, behind a Preview, Code or
 * Takes tab, or in the bar's More menu. This opens whatever hides it and
 * returns the locator to use, which is the More menu's copy for a bar control
 * that moved there. Every capability must stay reachable this way at every
 * size (src/client/layout.js).
 *
 * @param {import("playwright-core").Page} page
 * @param {import("playwright-core").Locator} control
 * @returns {Promise<import("playwright-core").Locator>}
 */
export async function reveal(page, control) {
  await control.waitFor({ state: "attached" })
  // A resize reaches the layout through a ResizeObserver; let it run first.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const where = await control.evaluate(node => {
    const cal = /** @type {HTMLElement} */ (document.querySelector(".cal"))
    const group = node.closest("[data-group]")
    if (group?.hasAttribute("data-overflow")) {
      return { tap: [".cal-more"], menu: node.closest(".cal-devices") ? { role: "radio", name: node.textContent ?? "" } : { role: "button", name: node.textContent ?? "" } }
    }
    /** @type {string[]} */
    const tap = []
    const inDrawer = node.closest(".cal-side") !== null
    const drawerOpen = cal.dataset.nav === "drawer" && cal.hasAttribute("data-nav-open")
    // The open drawer covers the work area; closing it is one tap on Parts.
    if (cal.dataset.nav === "drawer" && inDrawer !== drawerOpen && !node.closest(".cal-bar")) tap.push(".cal-nav-toggle")
    if (cal.hasAttribute("data-tabs")) {
      const view = node.closest(".cal-takes") ? "takes" : node.closest(".cal-code") ? "code" : node.closest(".cal-main") ? "preview" : null
      if (view && cal.dataset.view !== view) tap.push(view === "takes" ? ".cal-takes-toggle" : view === "code" ? ".cal-code-toggle" : ".cal-preview-tab")
    }
    return { tap, menu: null }
  })
  for (const selector of where.tap) await page.locator(selector).click()
  if (where.menu) {
    return page.locator(".cal-more-menu").getByRole(/** @type {"radio" | "button"} */ (where.menu.role), { name: where.menu.name, exact: true })
  }
  return control
}
