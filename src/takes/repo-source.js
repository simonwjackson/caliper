// @ts-check
import { execFileSync } from "node:child_process"
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

/** Folders the row agent never reads, at any depth. */
const HIDDEN = new Set(["node_modules", ".git", ".caliper"])

/**
 * What a row agent may read (workspaces slice 2): the source of the
 * project's whole repository, read-only. A row composes product code, and
 * in a monorepo that code can sit beside the project, as Pico's input comes
 * from the portal in `clients/portal`. Paths are relative to the project
 * root, so `../../clients/portal/src/input/bus.ts` names a sibling package.
 * Outside a Git checkout, the repository is the project.
 *
 * Never: a path outside the repository, `node_modules`, `.git`, `.caliper`,
 * an environment file, or a link that leaves the repository.
 *
 * @param {string} root absolute project root
 */
export function createRepoSource(root) {
  /** @type {string | null} */
  let top = null
  const repository = () => {
    if (top !== null) return top
    try { top = realpathSync(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()) }
    catch { top = realpathSync(root) }
    return top
  }

  /** @param {string} file as the agent wrote it @returns {string} absolute */
  const fence = file => {
    if (typeof file !== "string" || file.trim() === "") throw new Error("The path is empty.")
    if (isAbsolute(file)) throw new Error(`"${file}" is absolute. Use a path relative to the project root.`)
    const repo = repository()
    const absolute = resolve(realpathSync(root), file)
    const inside = relative(repo, absolute)
    if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) throw new Error(`"${file}" is outside the project's repository.`)
    const segments = inside.split(sep)
    const hidden = segments.find(segment => HIDDEN.has(segment))
    if (hidden !== undefined) throw new Error(`"${file}" is inside ${hidden}/, which a row agent cannot read.`)
    const name = segments.at(-1) ?? ""
    if (name === ".env" || name.startsWith(".env.")) throw new Error(`"${file}" is an environment file. It can hold secrets.`)
    let probe = absolute
    while (!existsSync(probe)) probe = dirname(probe)
    const real = relative(repo, realpathSync(probe))
    if (real.startsWith("..") || isAbsolute(real)) throw new Error(`"${file}" goes through a link out of the repository.`)
    return absolute
  }

  /** @param {string} file relative to the project root */
  const readSource = file => {
    const path = fence(file)
    if (!existsSync(path)) throw new Error(`"${file}" does not exist.`)
    if (lstatSync(path).isDirectory()) throw new Error(`"${file}" is a folder. Use list_files.`)
    return readFileSync(path, "utf8")
  }

  /**
   * The files under a folder, as paths relative to the project root. Git
   * decides what counts in a checkout; otherwise Caliper walks the folder and
   * skips dot-folders.
   *
   * @param {string} folder relative to the project root; "" is the project
   * @returns {string[]} sorted
   */
  const listSource = folder => {
    const base = folder === "" || folder === "." ? resolve(realpathSync(root)) : fence(folder)
    const repo = repository()
    /** @type {string[]} */
    let found
    try {
      found = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "."], { cwd: base, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
        .split("\0").filter(Boolean).map(file => join(base, file))
    } catch {
      found = []
      /** @param {string} directory */
      const walk = directory => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          if (entry.name.startsWith(".") || entry.name === "node_modules") continue
          const path = join(directory, entry.name)
          if (entry.isDirectory()) walk(path)
          else found.push(path)
        }
      }
      if (existsSync(base)) walk(base)
    }
    const projectRoot = realpathSync(root)
    return found
      .filter(path => {
        const inside = relative(repo, path)
        if (inside.startsWith("..")) return false
        const segments = inside.split(sep)
        const name = segments.at(-1) ?? ""
        return !segments.some(segment => HIDDEN.has(segment)) && name !== ".env" && !name.startsWith(".env.")
      })
      .map(path => relative(projectRoot, path).split(sep).join("/"))
      .sort()
  }

  return { readSource, listSource }
}
