// @ts-check
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

export const CHECK_RUNTIME_MODULE = "virtual:caliper/check-runtime"
const RESOLVED_RUNTIME = "\0caliper:check-runtime"
const LIBRARIES_ID = "@caliper-internal/check-libraries"
const LIBRARIES_FILE = fileURLToPath(new URL("./libraries.js", import.meta.url))
const BROWSER_FILE = fileURLToPath(new URL("./browser.js", import.meta.url))

/**
 * Hooks for the parent Caliper plugin; not a second product server or bundler.
 *
 * Merge config() into the plugin's config result using Vite mergeConfig. Call
 * resolveId.call(this, id, importer) before take-overlay resolution, and return
 * its non-null result. Call load(id) before the plugin's other load handlers.
 *
 * The browser entry imports './libraries.js'. Vite optimizes that one trusted
 * entry with dependencies resolved from THIS Caliper installation. A private
 * alias avoids rebinding any dependency in product code. optimizeDeps.include
 * prepares the module but never adds a browser import to ordinary previews.
 * The virtual browser source is read only when requested. Vite owns all helper
 * dependency conversion, including CommonJS, in linked and packed installs.
 */
export function authoredCheckDelivery() {
  return {
    /** @returns {import('vite').UserConfig} */
    config() {
      return {
        resolve: { alias: { [LIBRARIES_ID]: LIBRARIES_FILE } },
        optimizeDeps: { include: [LIBRARIES_ID] },
      }
    },
    /**
     * @this {import('vite').Rollup.PluginContext}
     * @param {string} id
     * @param {string | undefined} importer
     */
    async resolveId(id, importer) {
      if (id === CHECK_RUNTIME_MODULE) return RESOLVED_RUNTIME
      if (id === "./libraries.js" && importer === RESOLVED_RUNTIME) {
        return this.resolve(LIBRARIES_ID, LIBRARIES_FILE, { skipSelf: true })
      }
      return null
    },
    /** @param {string} id @returns {string | null} */
    load(id) {
      return id === RESOLVED_RUNTIME ? readFileSync(BROWSER_FILE, "utf8") : null
    },
  }
}
