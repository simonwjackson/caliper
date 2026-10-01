// @ts-check
import { existsSync } from "node:fs"
import { chromium } from "playwright-core"

/**
 * The Chromium that renders and checks use. `CHROMIUM` wins. Without it, use the
 * browser that `npx playwright-core install chromium` downloads, if it is there.
 *
 * @param {Record<string, string | undefined>} env
 * @param {() => string} [playwrightPath] Playwright's expected path, for tests.
 * @returns {string | undefined}
 */
export function chromiumExecutable(env, playwrightPath = () => chromium.executablePath()) {
  if (env.CHROMIUM) return env.CHROMIUM
  try {
    const path = playwrightPath()
    return path && existsSync(path) ? path : undefined
  } catch {
    return undefined
  }
}

/** What to tell a user who has no Chromium. */
export const NO_CHROMIUM = "Set CHROMIUM to a Chromium executable, or run `npx playwright-core install chromium` once."
