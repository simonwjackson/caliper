// @ts-check
// Values that cross between the central app's agent and a project's plugin.
// JSON has no bytes, sets or maps, so each is marked.

/**
 * Replace every Buffer or Uint8Array with `{ $bytes: base64 }`.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function encode(value) {
  if (value instanceof Uint8Array) return { $bytes: Buffer.from(value).toString("base64") }
  if (value instanceof Set) return { $set: [...value].map(encode) }
  if (value instanceof Map) return { $map: [...value].map(([key, item]) => [encode(key), encode(item)]) }
  if (Array.isArray(value)) return value.map(encode)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, encode(item)]))
  }
  return value
}

/**
 * The reverse of `encode`.
 *
 * @param {unknown} value
 * @returns {any}
 */
export function decode(value) {
  if (Array.isArray(value)) return value.map(decode)
  if (value !== null && typeof value === "object") {
    const record = /** @type {Record<string, unknown>} */ (value)
    const only = Object.keys(record).length === 1
    if (only && typeof record.$bytes === "string") return Buffer.from(record.$bytes, "base64")
    if (only && Array.isArray(record.$set)) return new Set(record.$set.map(decode))
    if (only && Array.isArray(record.$map)) return new Map(record.$map.map((/** @type {[unknown, unknown]} */ [key, item]) => [decode(key), decode(item)]))
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, decode(item)]))
  }
  return value
}

/**
 * The methods the central app may call on each part of a project. The plugin
 * refuses any other name, so the list is the whole host interface.
 */
export const HOST_METHODS = /** @type {const} */ ({
  store: ["list", "create", "fork", "record", "update", "addImages", "image", "original", "reset", "read", "write", "files", "listFiles", "accept", "accepted", "discard", "overview"],
  marks: ["read", "current", "add", "change", "remove", "release"],
  integration: ["begin", "submit", "review", "beginCheck", "finishCheck", "apply", "summary"],
  parts: ["discover"],
  skills: ["list", "content", "read"],
  workspaces: ["list", "read", "overview", "rowParts", "create", "setQuestion", "setName", "pin", "unpin", "ask", "answer", "close",
    "addScratch", "writeRow", "readRow", "removeScratch", "readSource", "listSource"],
})
