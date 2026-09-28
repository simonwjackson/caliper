// @ts-check
import { existsSync, realpathSync } from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

/** Resolve links in existing ancestors without creating anything.
 * @param {string} input
 */
function physical(input) {
  let directory = resolve(input)
  const tail = []
  while (!existsSync(directory)) {
    const parent = dirname(directory)
    if (parent === directory) break
    tail.unshift(basename(directory))
    directory = parent
  }
  return join(realpathSync(directory), ...tail)
}
/** Reject source-producing output before the runner creates its directory.
 * Checking both paths prevents an outside alias into source and an inside
 * source symlink pointing outside from bypassing the same rule.
 * @param {string} root @param {string} output
 */
export function validateCheckOutput(root, output) {
  for (const [base, target] of [
    [resolve(root), resolve(output)],
    [physical(root), physical(output)],
  ]) {
    const inside = relative(base, target)
    const inProject = inside === "" || (!isAbsolute(inside) && inside !== ".." && !inside.startsWith(`..${sep}`))
    if (inProject && inside !== `.caliper${sep}checks` && !inside.startsWith(`.caliper${sep}checks${sep}`)) {
      throw new Error(
        "Check output inside the project must be under .caliper/checks; another source directory would invalidate its own run. Use --out .caliper/checks or a directory outside the project.",
      )
    }
  }
}
