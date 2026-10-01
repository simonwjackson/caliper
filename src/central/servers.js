// @ts-check
// Which registry files are the dev servers they claim to be (decision 39).
// A file only claims a server: after a crash its pid can belong to another
// process, and its port to another dev server. So the app asks each server
// for its `hello` and keeps a file only when the answer names the file's
// project and pid. Answers are kept for a short while, so routing does not
// wait on a check for each request.
import { PROTOCOL, readRegistry, removeEntry } from "./registry.js"

/** How long the app waits for one `hello`. */
export const HELLO_TIMEOUT_MS = 1500
/** How long one answer stands before the app asks again. */
export const ANSWER_FRESH_MS = 2000

/**
 * An entry as the app sees it. `silent` holds why its server did not answer;
 * the app does not route to it.
 *
 * @typedef {import("./registry.js").Entry & { silent?: string }} Seen
 * @typedef {{ _tag: "Same" } | { _tag: "Other" } | { _tag: "Silent", reason: string } | { _tag: "Unchecked" }} Answer
 */

/**
 * A URL below a server's `<base>__caliper/`.
 *
 * @param {{ url: string, base: string }} server
 * @param {string} path
 */
export const pluginUrl = (server, path) => new URL(`${server.base.replace(/\/?$/, "/").replace(/^\/?/, "")}__caliper/${path}`, server.url)

/**
 * @param {{ registry: string, timeoutMs?: number, freshMs?: number }} input
 */
export function createServerCheck({ registry, timeoutMs = HELLO_TIMEOUT_MS, freshMs = ANSWER_FRESH_MS }) {
  /** One answer per server start. @type {Map<string, { at: number, answer: Promise<Answer> }>} */
  const answers = new Map()
  /** @param {import("./registry.js").Entry} entry */
  const key = entry => `${entry.pid}-${entry.id}-${entry.token}`

  return {
    /**
     * The registry's entries, without the files a check proved stale; those
     * files are deleted. An entry of another protocol is not asked, since its
     * `hello` can differ; the app does not route to it anyway.
     *
     * @returns {Promise<Seen[]>}
     */
    list: async () => {
      const entries = readRegistry(registry)
      const now = Date.now()
      const current = new Set(entries.map(key))
      for (const known of answers.keys()) if (!current.has(known)) answers.delete(known)
      const found = await Promise.all(entries.map(entry => {
        if (entry.protocol !== PROTOCOL) return /** @type {Answer} */ ({ _tag: "Unchecked" })
        let held = answers.get(key(entry))
        if (held === undefined || now - held.at >= freshMs) {
          held = { at: now, answer: hello(entry, timeoutMs) }
          answers.set(key(entry), held)
        }
        return held.answer
      }))
      return entries.flatMap((entry, index) => {
        const answer = /** @type {Answer} */ (found[index])
        if (answer._tag === "Other") {
          removeEntry(registry, entry)
          answers.delete(key(entry))
          return []
        }
        return answer._tag === "Silent" ? [{ ...entry, silent: answer.reason }] : [entry]
      })
    },
  }
}

/**
 * Ask the server at an entry's URL who it is. The token stays home: the
 * server at that URL may not be the entry's.
 *
 * @param {import("./registry.js").Entry} entry
 * @param {number} timeoutMs
 * @returns {Promise<Answer>}
 */
async function hello(entry, timeoutMs) {
  const url = pluginUrl(entry, "hello")
  /** @type {Response} */
  let response
  /** @type {unknown} */
  let body
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" })
    body = await response.json().catch(() => null)
  } catch (error) {
    return { _tag: "Silent", reason: reasonOf(error, url, timeoutMs) }
  }
  const said = /** @type {Record<string, unknown> | null} */ (body !== null && typeof body === "object" ? body : null)
  // Only a Caliper plugin answers hello with an id. Anything else is not
  // proof of a stale file: it can be a server with a broken plugin.
  if (!response.ok || said === null || typeof said.id !== "string") return { _tag: "Silent", reason: `${url.host} answered ${response.status}, not as a Caliper dev server` }
  return said.protocol === entry.protocol && said.id === entry.id && said.pid === entry.pid ? { _tag: "Same" } : { _tag: "Other" }
}

/** @param {unknown} error @param {URL} url @param {number} timeoutMs */
function reasonOf(error, url, timeoutMs) {
  const failure = /** @type {{ name?: string, message?: string, cause?: { code?: string, message?: string } }} */ (error)
  if (failure?.name === "TimeoutError" || failure?.name === "AbortError") return `no answer from ${url.host} within ${timeoutMs / 1000} s`
  if (failure?.cause?.code === "ECONNREFUSED" || /ECONNREFUSED|Unable to connect/i.test(failure?.message ?? "")) return `nothing listens on ${url.host}`
  // Node's fetch says only "fetch failed"; the cause says why.
  return `${url.host}: ${failure?.cause?.message ?? failure?.message ?? String(error)}`
}
