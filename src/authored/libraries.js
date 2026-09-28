// @ts-check
import * as chai from "chai"
import { JestAsymmetricMatchers, JestChaiExpect, JestExtend } from "@vitest/expect"
import * as matchers from "@testing-library/jest-dom/matchers"

export { within, waitFor } from "@testing-library/dom"

// Public standalone plugin recipe, pinned to @vitest/expect 4.1.10. The raw
// extension method takes expect first; the full runner normally binds it.
// Do not create worker, process, browser-runner or global expect shims.
chai.use(JestExtend)
chai.use(JestChaiExpect)
chai.use(JestAsymmetricMatchers)
if (!("extend" in chai.expect) || typeof chai.expect.extend !== "function") {
  throw new Error("@vitest/expect did not install its extension method")
}
chai.expect.extend(chai.expect, matchers)

/** The installed plugin surface, deliberately narrower than Vitest's runner API. */
export const expect = /** @type {import('./checks').CheckExpect} */ (/** @type {unknown} */ (chai.expect))
