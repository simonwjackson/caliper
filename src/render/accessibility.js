// @ts-check
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
export const axeVersion = /** @type {{ version: string }} */ (require("axe-core/package.json")).version
const axePath = require.resolve("axe-core/axe.min.js")

/**
 * Audit only the product host. Document metadata belongs to Caliper's frame,
 * not to the part. Keep incomplete checks visible rather than treating them as passes.
 * @param {import("playwright-core").Page} page
 * @returns {Promise<import("./check-contract.js").Accessibility>}
 */
export async function auditAccessibility(page) {
  try {
    await page.addScriptTag({ path: axePath })
    return await page.evaluate(async () => {
      const axe = /** @type {Window & { axe?: typeof import("axe-core") }} */ (window).axe
      if (!axe) throw new Error("axe did not load in the product frame.")
      const result = await axe.run("#caliper-host", {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
        rules: { "document-title": { enabled: false }, "html-has-lang": { enabled: false }, "html-lang-valid": { enabled: false } },
      })
      /** @param {import("axe-core").Result} finding */
      const describe = finding => ({
        id: finding.id, impact: finding.impact ?? null, help: finding.help, url: finding.helpUrl,
        nodes: finding.nodes.map(node => ({ target: JSON.stringify(node.target), summary: node.failureSummary ?? "Needs manual review." })),
      })
      return { _tag: /** @type {const} */ ("Complete"), violations: result.violations.map(describe), incomplete: result.incomplete.map(describe) }
    })
  } catch (error) {
    return { _tag: "Unavailable", reason: error instanceof Error ? error.message : String(error) }
  }
}
