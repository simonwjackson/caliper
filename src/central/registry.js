// @ts-check
// The registry of running Caliper dev servers (decision 37). Each plugin writes
// one file when Vite listens and removes it when Vite closes. The central app
// reads the folder for each request, so a server that restarts on another
// port keeps its project id and keeps working.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { chmodSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * The wire version. The central app routes only to a plugin with the same
 * number. Raise it for any change to the registry file, the routing paths,
 * `hello` or the host calls. There is no support for older numbers.
 */
export const PROTOCOL = 1

/**
 * @typedef {{
 *   protocol: number, id: string, pid: number, root: string, name: string,
 *   url: string, base: string, token: string, started: string,
 * }} Entry
 */

/**
 * The folder of registry files. `CALIPER_REGISTRY` names another folder, for
 * tests and for running two separate sets of servers.
 *
 * @param {Record<string, string | undefined>} [env]
 */
export function registryDir(env = process.env) {
  if (env.CALIPER_REGISTRY) return env.CALIPER_REGISTRY
  return join(env.XDG_STATE_HOME || join(homedir(), ".local/state"), "caliper/servers")
}

/**
 * A project's id: the first 12 hex digits of the SHA-256 of its root's real path.
 *
 * @param {string} root
 */
export function projectId(root) {
  let real = root
  try { real = realpathSync(root) } catch { /* a root that does not exist keeps its own path */ }
  return createHash("sha256").update(real).digest("hex").slice(0, 12)
}

/** A new token for one server start. */
export const newToken = () => randomBytes(32).toString("base64url")

/**
 * Compare a request's bearer token with the server's, in constant time.
 *
 * @param {string | undefined} header the Authorization header
 * @param {string} token
 */
export function tokenMatches(header, token) {
  const given = Buffer.from(/^Bearer (.+)$/.exec(header ?? "")?.[1] ?? "")
  const wanted = Buffer.from(token)
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

/**
 * Write one server's entry. The file is written under a temporary name and
 * renamed, so a reader never sees half of it.
 *
 * @param {string} dir
 * @param {Entry} entry
 * @returns {() => void} removes the file
 */
export function writeEntry(dir, entry) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  const file = join(dir, `${entry.pid}-${entry.id}.json`)
  const partial = `${file}.tmp`
  writeFileSync(partial, `${JSON.stringify(entry, null, 2)}\n`, { mode: 0o600 })
  renameSync(partial, file)
  return () => rmSync(file, { force: true })
}

/**
 * @param {unknown} value
 * @returns {value is Entry}
 */
function isEntry(value) {
  const entry = /** @type {Record<string, unknown>} */ (value)
  return entry !== null && typeof entry === "object"
    && typeof entry.protocol === "number" && typeof entry.id === "string" && /^[0-9a-f]{12}$/.test(entry.id)
    && Number.isInteger(entry.pid) && typeof entry.root === "string" && typeof entry.name === "string"
    && typeof entry.url === "string" && typeof entry.base === "string" && typeof entry.token === "string"
    && typeof entry.started === "string"
}

/**
 * Every entry whose process still runs. Files of dead processes are deleted.
 * A file that is not an entry is skipped, not deleted: it can be mid-write.
 *
 * @param {string} dir
 * @returns {Entry[]}
 */
export function readRegistry(dir) {
  /** @type {string[]} */
  let names
  try { names = readdirSync(dir) } catch { return [] }
  /** @type {Entry[]} */
  const live = []
  for (const name of names.filter(file => file.endsWith(".json")).sort()) {
    const file = join(dir, name)
    /** @type {unknown} */
    let value
    try { value = JSON.parse(readFileSync(file, "utf8")) } catch { continue }
    if (!isEntry(value)) continue
    if (!alive(value.pid)) { rmSync(file, { force: true }); continue }
    live.push(value)
  }
  return live
}

/** @param {number} pid */
function alive(pid) {
  try { process.kill(pid, 0); return true }
  catch (error) { return /** @type {NodeJS.ErrnoException} */ (error).code === "EPERM" }
}
