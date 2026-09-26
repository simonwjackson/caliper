import type { CaliperOptions } from "./types"

export type { CaliperOptions } from "./types"

/**
 * The plugin, typed only by what a project needs to see. Not typed as Vite's
 * `Plugin`: a linked Caliper checkout carries its own copy of Vite's types,
 * and two copies of `Plugin` do not match each other.
 */
export type CaliperPlugin = {
  readonly name: "caliper"
  readonly apply: "serve"
}

/** Everything Caliper serves lives under this path on the project's dev server. */
export declare const CALIPER_PATH: "/__caliper"

/**
 * Caliper: see the project's own UI parts at true physical device size.
 *
 * Add it to the project's vite.config and open `/__caliper/` on the dev
 * server. It runs only under `vite dev`, never in a build. Set options only
 * when discovery fails or global styles are not imported directly by the entry.
 */
export declare function caliper(options?: CaliperOptions): CaliperPlugin
