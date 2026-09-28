// @ts-check

/**
 * The rules every Caliper write endpoint follows: who may write, how large a
 * body may be, and how answers are sent.
 *
 * @typedef {import("node:http").IncomingMessage} IncomingMessage
 * @typedef {import("node:http").ServerResponse} ServerResponse
 */

/** The largest request body, in bytes, unless the endpoint names another limit. */
export const MAX_BODY = 64 * 1024
/** A write that carries a whole file. */
export const MAX_FILE_BODY = 4 * 1024 * 1024

/**
 * Only the chrome may write. A write needs a POST with a JSON body, which a
 * page on another site cannot send without a CORS preflight, and an Origin,
 * when the browser sends one, of the dev server itself.
 *
 * @param {IncomingMessage} request
 * @returns {string | null} why the request is refused, or null
 */
export function refuse(request) {
  if (request.method !== "POST") return "Use POST."
  if (!(request.headers["content-type"] ?? "").startsWith("application/json")) return "Send a JSON body."
  const origin = request.headers.origin
  if (origin !== undefined && origin !== "null") {
    const host = request.headers.host
    if (host === undefined || new URL(origin).host !== host) return "Only Caliper's own page can change files and takes."
  }
  return null
}

/**
 * @param {IncomingMessage} request
 * @param {number} [limit] the largest body, in bytes
 * @returns {Promise<unknown>}
 */
export async function readJson(request, limit = MAX_BODY) {
  let size = 0
  /** @type {Buffer[]} */
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) throw new Error("The request body is too large.")
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString("utf8")
  if (text.trim() === "") return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new Error("The request body is not JSON.")
  }
}

/**
 * One root-relative file and its whole new content, as a save sends it.
 *
 * @param {unknown} body
 */
export function validFile(body) {
  const { file, content } = /** @type {Record<string, unknown>} */ (body ?? {})
  if (typeof file !== "string" || file.trim() === "") throw new Error("Name the file to save.")
  if (typeof content !== "string") throw new Error("Send the file's content as a string.")
  return { file, content }
}

/**
 * @param {ServerResponse} response
 * @param {number} status
 * @param {unknown} body
 */
export function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
  response.end(JSON.stringify(body))
}
