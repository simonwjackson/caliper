// @ts-check
import { createHash, randomUUID } from "node:crypto"
import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { TAKES_DIR } from "../takes/store.js"

const ignored = new Set(["node_modules", ".git", ".caliper", ".vite", ".worktree", ".worktrees"])
const generated = new Set(["dist", "build", "coverage"])
/** Content identity and observed changes share one exclusion policy across callers.
 * @param {{root:string, cacheDir?:string, store:import('../takes/store.js').TakeStore}} input
 */
export function createSourceRevision({ root: directory, cacheDir, store }) {
  const root = resolve(directory)
  const cache = resolve(root, cacheDir ?? "node_modules/.vite")
  const epoch = randomUUID()
  let generation = 0
  const takes = new Map()
  /** @param {string} file */
  const excluded = file => {
    const path = relative(root, file)
    const segments = path.split(sep)
    return (
      !path ||
      path.startsWith(`..${sep}`) ||
      isAbsolute(path) ||
      file === cache ||
      file.startsWith(`${cache}${sep}`) ||
      segments.some(segment => ignored.has(segment)) ||
      generated.has(segments[0] ?? "")
    )
  }
  /** @param {{take?:string}} request */
  const fingerprint = request => {
    const hash = createHash("sha256")
    /** @param {string} directory @param {Set<string>} ancestors @param {boolean} take */
    const walk = (directory, ancestors, take) => {
      const real = realpathSync(directory)
      if (ancestors.has(real)) return
      const next = new Set([...ancestors, real])
      for (const name of readdirSync(directory).sort()) {
        const file = join(directory, name)
        if (take ? ignored.has(name) : excluded(file)) continue
        let stat = lstatSync(file)
        if (stat.isSymbolicLink()) {
          hash.update(JSON.stringify([relative(root, file), readlinkSync(file)]))
          try {
            stat = lstatSync(realpathSync(file))
          } catch {
            continue
          }
        }
        if (stat.isDirectory()) walk(file, next, take)
        else if (stat.isFile())
          hash.update(
            JSON.stringify([relative(root, file), createHash("sha256").update(readFileSync(file)).digest("hex")]),
          )
      }
    }
    walk(root, new Set(), false)
    if (request.take !== undefined) {
      if (!/^[1-9][0-9]*$/.test(request.take) || store.record(request.take) === null)
        throw new Error(`Take ${request.take} no longer exists.`)
      hash.update(readFileSync(join(root, TAKES_DIR, `${request.take}.json`)))
      walk(join(root, TAKES_DIR, request.take), new Set(), true)
    }
    return hash.digest("hex")
  }
  /** @param {string} input */
  const invalidate = input => {
    const file = resolve(root, input)
    const takePath = relative(join(root, TAKES_DIR), file).split(sep)
    const id = /^([1-9][0-9]*)(?:\.json)?$/.exec(takePath[0] ?? "")?.[1]
    if (id) {
      takes.set(id, (takes.get(id) ?? 0) + 1)
    } else if (!excluded(file)) generation++
  }
  /** @param {{take?:string}} request */
  const stamp = request => ({ epoch, generation: generation + (request.take ? (takes.get(request.take) ?? 0) : 0) })
  return {
    fingerprint,
    invalidate,
    stamp,
    /** @param {{take?:string}} request */
    revision: request => ({ ...stamp(request), fingerprint: fingerprint(request) }),
    close() {},
  }
}
