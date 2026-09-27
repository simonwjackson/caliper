// @ts-check
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"

/** @typedef {import('../render/render.js').RenderResult} RenderResult */

/**
 * Compare two baselines before judging a proposal. An unstable baseline is
 * inconclusive, never evidence that existing callers stayed unchanged.
 * @param {{ originals: () => Promise<RenderResult[]>, proposed: () => Promise<RenderResult[]>, alternate: () => Promise<RenderResult[]> }} render
 */
export async function verifyIntegration(render) {
  const first = fingerprints(await render.originals())
  const second = fingerprints(await render.originals())
  compare(first, second, "The original render is unstable")
  const proposed = fingerprints(await render.proposed())
  compare(first, proposed, "The proposal changes an existing state")
  const alternates = await render.alternate()
  fingerprints(alternates)
  for (const result of alternates) {
    if (result.frame !== "Rendered") throw new Error(`The alternate ${key(result)} did not render visible content.`)
    if (result.spill) throw new Error(`The alternate ${key(result)} spills past its viewport. Fix it before applying.`)
  }
  return `${first.size} existing state/device renders match two stable baselines. ${alternates.length} alternate renders passed. These checks do not prove interaction behavior or type safety.`
}

/** @param {RenderResult} result */
function key(result) { return `${result.part} · ${result.state} · ${result.device}` }

/** @param {RenderResult[]} results */
function fingerprints(results) {
  if (results.length === 0) throw new Error("No states were rendered. The integration is not verified.")
  const prints = new Map()
  for (const result of results) {
    const problems = result.problems.filter(problem => !(result.frame === "Empty"
      && problem.kind === "warning"
      && problem.title === `${result.part} rendered nothing: its component returned null or an empty tree.`
      && problem.detail === ""))
    if (result.frame === "Failed" || problems.length || result.console.length) {
      throw new Error(`Render failed for ${key(result)}: ${JSON.stringify({ problems: result.problems, console: result.console })}`)
    }
    prints.set(key(result), `${result.frame}:${createHash("sha256").update(readFileSync(result.png)).digest("hex")}`)
  }
  return prints
}

/** @param {Map<string, string>} before @param {Map<string, string>} after @param {string} reason */
function compare(before, after, reason) {
  if (before.size !== after.size) throw new Error(`${reason}: the state coverage changed.`)
  for (const [state, hash] of before) {
    if (after.get(state) !== hash) throw new Error(`${reason}: ${state}. Review the difference before trying again.`)
  }
}
