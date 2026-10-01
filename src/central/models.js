// @ts-check
// The models the app's model picker offers (decision 43). The endpoint names
// every model; pi's scoped models, `enabledModels` in pi's settings, name the
// favorites. Caliper reads only that list from pi: never a key or an endpoint.
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { catalogModels } from "../agent/model.js"

/**
 * @typedef {{ current: string, favorites: string[], models: string[], problem?: string }} ModelChoices
 *   `favorites` and `models` do not overlap. `problem` says why a list is short.
 */

/** pi's own variable for its settings folder. */
export const PI_DIR_ENV = "PI_CODING_AGENT_DIR"
const THINKING = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"])
const LIST_TIMEOUT_MS = 5_000

/**
 * pi's scoped models: the patterns in `enabledModels`. Empty when pi is not
 * set up or its settings cannot be read; favorites are a convenience, so
 * their absence is not an error.
 *
 * @param {Record<string, string | undefined>} env
 * @param {string} home
 * @returns {string[]}
 */
export function piFavorites(env, home) {
  const file = join(env[PI_DIR_ENV] || join(home, ".pi", "agent"), "settings.json")
  if (!existsSync(file)) return []
  try {
    const patterns = JSON.parse(readFileSync(file, "utf8"))?.enabledModels
    return Array.isArray(patterns) ? patterns.filter(pattern => typeof pattern === "string" && pattern.trim() !== "") : []
  } catch {
    return []
  }
}

/**
 * The endpoint's models that pi's patterns name, in the patterns' order. A
 * pattern works as in pi's `--models`: `provider/id` or `id`, an optional
 * `:thinking` suffix, and `*`, `?` and `[...]` globs, without case. Caliper
 * has no pi providers, so the part before the first `/` may name any. Unlike
 * pi, a pattern that is not a glob must name the whole id.
 *
 * With no list from the endpoint (`ids` is null), each pattern that is not a
 * glob stands for its own id, so a favorite stays reachable.
 *
 * @param {readonly string[]} patterns
 * @param {readonly string[] | null} ids
 * @returns {string[]}
 */
export function matchFavorites(patterns, ids) {
  /** @type {string[]} */
  const found = []
  const add = (/** @type {string} */ id) => { if (!found.includes(id)) found.push(id) }
  for (const pattern of patterns) {
    const forms = patternForms(pattern.trim())
    if (ids === null) {
      // The barest form: no provider and no thinking suffix.
      const plains = forms.filter(form => !isGlob(form))
      const plain = plains.filter(form => !form.includes("/")).at(-1) ?? plains.at(-1)
      if (plain !== undefined) add(plain)
      continue
    }
    const tests = forms.map(form => isGlob(form) ? globTest(form) : (/** @type {string} */ id) => id.toLowerCase() === form.toLowerCase())
    for (const id of ids) if (tests.some(test => test(id))) add(id)
  }
  return found
}

/**
 * The ways a pattern can name an id: as written, without its provider, and
 * each of those without a thinking suffix.
 *
 * @param {string} pattern
 */
function patternForms(pattern) {
  const colon = pattern.lastIndexOf(":")
  const bases = colon > 0 && THINKING.has(pattern.slice(colon + 1)) ? [pattern, pattern.slice(0, colon)] : [pattern]
  return [...new Set(bases.flatMap(base => base.includes("/") ? [base, base.slice(base.indexOf("/") + 1)] : [base]))]
}

/** @param {string} pattern */
const isGlob = pattern => /[*?[]/.test(pattern)

/**
 * @param {string} glob
 * @returns {(id: string) => boolean}
 */
function globTest(glob) {
  let source = ""
  for (let index = 0; index < glob.length; index++) {
    const char = /** @type {string} */ (glob[index])
    if (char === "*") source += ".*"
    else if (char === "?") source += "."
    else if (char === "[") {
      const end = glob.indexOf("]", index + 1)
      if (end === -1) { source += "\\["; continue }
      const body = glob.slice(index + 1, end).replace(/\\/g, "\\\\")
      source += `[${body.startsWith("!") ? `^${body.slice(1)}` : body}]`
      index = end
    } else source += char.replace(/[.+^${}()|\\]/g, "\\$&")
  }
  const regex = new RegExp(`^${source}$`, "i")
  return id => regex.test(id)
}

/**
 * Every model the endpoint offers. The OpenAI APIs list theirs at
 * `GET <baseUrl>/models`; for `anthropic` and `google`, pi-ai's catalog does.
 *
 * @param {import("../agent/config.js").Connection} connection
 * @param {typeof fetch} [request]
 * @returns {Promise<string[]>}
 */
export async function endpointModels(connection, request = fetch) {
  if (connection.api === "anthropic" || connection.api === "google") return catalogModels(connection.api)
  const response = await request(`${connection.baseUrl}/models`, {
    headers: { authorization: `Bearer ${connection.apiKey}` },
    signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`${connection.baseUrl}/models answered ${response.status}.`)
  const data = /** @type {{ data?: unknown }} */ (await response.json())?.data
  if (!Array.isArray(data)) throw new Error(`${connection.baseUrl}/models did not answer with a model list.`)
  return [...new Set(data.flatMap(item => typeof item?.id === "string" && item.id !== "" ? [item.id] : []))]
}

/**
 * What the picker shows: the current model, the favorites the endpoint
 * serves, and every other model, sorted.
 *
 * @param {{ current: string, connection: import("../agent/config.js").Connection, patterns: readonly string[], request?: typeof fetch }} input
 * @returns {Promise<ModelChoices>}
 */
export async function modelChoices({ current, connection, patterns, request }) {
  /** @type {string[] | null} */
  let ids
  /** @type {string | undefined} */
  let problem
  try {
    ids = await endpointModels(connection, request)
  } catch (error) {
    ids = null
    const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : ""
    problem = `Caliper could not list the endpoint's models. ${error instanceof Error ? error.message : String(error)}${cause}`
  }
  const favorites = matchFavorites(patterns, ids)
  const models = (ids ?? []).filter(id => !favorites.includes(id)).sort((left, right) => left.localeCompare(right))
  return { current, favorites, models, ...(problem !== undefined ? { problem } : {}) }
}
