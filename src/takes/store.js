// @ts-check
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from "node:path"
import { Check } from "typebox/value"
import { IMAGE_TYPES } from "../client/images.js"
import { AcceptRecordSchema, MAX_ACCEPTED } from "./accepted-contract.js"

/**
 * Where takes live, and what an agent may read and write.
 *
 * A take is a folder of edited copies of project files, at the same relative
 * paths as the real files:
 *
 *   <root>/.caliper/takes/<n>/<path of the real file>
 *   <root>/.caliper/takes/<n>.json   what the take was asked to do
 *   <root>/.caliper/takes/<n>.images/<k>.<ext>   images you attached to its prompts
 *
 * Images sit beside the take's folder, not in it, so accept can never copy
 * one into the project.
 *
 * `.caliper/` holds a `.gitignore` that ignores the whole folder, so the
 * project needs no change to keep takes out of Git.
 *
 * @typedef {{ _tag: "Inside", file: string } | { _tag: "Outside", reason: string }} Fenced
 *   `file` is root-relative, with forward slashes.
 * @typedef {import("../types").Direction} Direction
 *   One way to answer a prompt, from the planner. `title` is a few words; `brief` says what the take tries.
 * @typedef {import("../types").TakeImage} TakeImage
 * @typedef {{ take: string, created: number }} TakeIdentity
 *   Take numbers are reused after a discard; the creation time tells two takes with one number apart.
 * @typedef {import("./marks-contract.js").Mark} Mark
 * @typedef {{ source: TakeIdentity, marks: Mark[] }} MarkupPass
 *   The marks one Send took from one take.
 * @typedef {{ prompt: string | null, direction?: Direction, lineage: TakeIdentity[], passes: MarkupPass[] }} TakeHistory
 *   What a take made from marks knows of its chain, as text. `lineage` runs from the chain's
 *   first take to the parent. `passes` are the earlier passes, oldest first; the take's own
 *   pass is its `marks`. A take keeps its own copy, so no discard or accept can break it.
 * @typedef {{ source: TakeIdentity, marks: Mark[] }} MarkReference
 *   Marks on another take, or on the original (take "0"), that this take's notes pointed to at Send.
 * @typedef {{ _tag: "Idea", workspace: string }} IdeaSubject
 *   A take that answers a workspace's question (decision 45). It belongs to no part.
 * @typedef {{ part: string, state: string, device: string, context?: import("../types").StateRef, subject?: undefined }} StateFields
 *   A take of one part and state. Every record from before workspaces has this shape.
 * @typedef {{ subject: IdeaSubject, device: string, part?: undefined, state?: undefined, context?: undefined }} IdeaFields
 *   `device` is where the idea's agent renders by default.
 * @typedef {{ name?: string, direction?: Direction, others?: string[], integration?: import('./integration.js').Integration, images?: TakeImage[], prompt?: string, parent?: TakeIdentity, chain?: TakeIdentity, history?: TakeHistory, marks?: Mark[], references?: MarkReference[] }} RecordFields
 * @typedef {(StateFields | IdeaFields) & RecordFields} NewTakeRecord
 *   What a new take is asked to do; the store adds `created`.
 * @typedef {NewTakeRecord & { created: number }} TakeRecord
 * @typedef {StateFields & RecordFields} NewStateTakeRecord
 * @typedef {NewStateTakeRecord & { created: number }} StateTakeRecord
 *   A take of a part. Marks, chains, accept and alternates work only on these.
 *   A state take's `part` and `state` identify the editing subject. Optional `context` identifies a declared
 *   composed preview. It does not restrict edits beyond the existing take-folder fence.
 *   Names, planner directions, and integration review metadata remain independent of that context.
 *   `prompt` is the first prompt. A take made from marks has `parent`, `chain` (the chain's first
 *   take), `history` and the `marks` it was sent, and no prompt of its own. `references` are the
 *   marks its notes pointed to; the agent may read those takes (planner choice 13). A take made
 *   from marks on the original has `marks` and `history` but no `parent` or `chain`.
 * @typedef {import("typebox").Static<typeof AcceptRecordSchema>} AcceptRecord
 *   One accept: the take, its subject, the real files it wrote, and when.
 */

/**
 * Whether a take is an idea of a workspace, not a take of a part.
 *
 * @template {NewTakeRecord} T
 * @param {T} record
 * @returns {record is T & IdeaFields}
 */
export function isIdea(record) {
  return record.subject?._tag === "Idea"
}

export const CALIPER_DIR = ".caliper"
export const TAKES_DIR = `${CALIPER_DIR}/takes`
const TAKE_ID = /^[1-9]\d*$/

/** Folders an agent never reads or writes, at any depth. */
const HIDDEN_FOLDERS = new Set(["node_modules", ".git", CALIPER_DIR])

/** @param {string} take */
export function isTakeId(take) {
  return TAKE_ID.test(take)
}

/**
 * Check that `file` names a project file an agent may touch: a relative path
 * inside the root, not in node_modules, .git or .caliper, not an environment
 * file (they hold secrets), and not reached through a symbolic link that
 * leaves the root.
 *
 * @param {string} root absolute
 * @param {string} file what the agent asked for
 * @returns {Fenced}
 */
export function fenceProjectPath(root, file) {
  if (typeof file !== "string" || file.trim() === "") return { _tag: "Outside", reason: "The path is empty." }
  if (isAbsolute(file)) return { _tag: "Outside", reason: `"${file}" is absolute. Use a path relative to the project root.` }
  const absolute = resolvePath(root, file)
  const inside = relative(root, absolute)
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) {
    return { _tag: "Outside", reason: `"${file}" is outside the project.` }
  }
  const segments = inside.split(sep)
  const hidden = segments.find(segment => HIDDEN_FOLDERS.has(segment))
  if (hidden !== undefined) return { _tag: "Outside", reason: `"${file}" is inside ${hidden}/, which takes cannot touch.` }
  const name = segments[segments.length - 1] ?? ""
  if (name === ".env" || name.startsWith(".env.")) return { _tag: "Outside", reason: `"${file}" is an environment file. It can hold secrets.` }
  const escape = symlinkEscape(root, absolute)
  if (escape !== null) return { _tag: "Outside", reason: `"${file}" goes through a link to ${escape}, outside the project.` }
  return { _tag: "Inside", file: segments.join("/") }
}

/**
 * The target of the first existing ancestor of `absolute` that resolves
 * outside `root`, or null.
 *
 * @param {string} root
 * @param {string} absolute
 */
function symlinkEscape(root, absolute) {
  const realRoot = realpathSync(root)
  let probe = absolute
  while (!existsSync(probe)) probe = dirname(probe)
  const real = realpathSync(probe)
  const inside = relative(realRoot, real)
  return inside.startsWith("..") || isAbsolute(inside) ? real : null
}

/**
 * The takes of one project, on disk.
 *
 * @param {string} root absolute Vite root
 */
export function createTakeStore(root) {
  const takesDir = join(root, TAKES_DIR)

  /** Metadata and copies must never alias real project files, even inside root.
   * @param {string} path
   */
  const safeTakePath = path => {
    let current = root
    for (const segment of relative(root, path).split(sep)) {
      current = join(current, segment)
      const stat = lstatSync(current, { throwIfNoEntry: false })
      if (stat?.isSymbolicLink()) throw new Error(`Unsafe symbolic link in take storage: ${current}.`)
      if (!stat) break
    }
    return path
  }

  /** @param {string} take */
  const folder = take => {
    if (!isTakeId(take)) throw new Error(`"${take}" is not a take number.`)
    return safeTakePath(join(takesDir, take))
  }

  /** @param {string} take */
  const recordFile = take => safeTakePath(`${folder(take)}.json`)

  /** @param {string} take */
  const imageFolder = take => safeTakePath(`${folder(take)}.images`)

  /**
   * @param {string} file what the agent asked for
   * @returns {string} the root-relative file
   */
  const fence = file => {
    const fenced = fenceProjectPath(root, file)
    if (fenced._tag === "Outside") throw new Error(fenced.reason)
    return fenced.file
  }

  /** @returns {string[]} take numbers, lowest first */
  const list = () => {
    safeTakePath(takesDir)
    if (!existsSync(takesDir)) return []
    return readdirSync(takesDir)
      .filter(name => name.endsWith(".json") && isTakeId(name.slice(0, -5)))
      .map(name => name.slice(0, -5))
      .sort((left, right) => Number(left) - Number(right))
  }

  /**
   * Start a new, empty take.
   *
   * @param {NewTakeRecord} ask
   * @returns {string} the take number
   */
  const create = ask => {
    mkdirSync(safeTakePath(takesDir), { recursive: true })
    const ignore = safeTakePath(join(root, CALIPER_DIR, ".gitignore"))
    if (!existsSync(ignore)) writeFileSync(ignore, "# Caliper's takes. Nothing here belongs in Git.\n*\n")
    const used = readdirSync(takesDir).map(name => Number.parseInt(name, 10)).filter(Number.isFinite)
    const take = String(Math.max(0, ...used) + 1)
    mkdirSync(folder(take), { recursive: true })
    // A new take starts with no images, even when it copies another take's record.
    const { images: _images, ...rest } = /** @type {NewTakeRecord} */ (ask)
    /** @type {TakeRecord} */
    const record = { ...rest, created: Date.now() }
    writeFileSync(recordFile(take), `${JSON.stringify(record, null, 2)}\n`)
    return take
  }

  /**
   * @param {string} take
   * @returns {TakeRecord | null}
   */
  const record = take => {
    const file = recordFile(take)
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null
  }

  /** @param {string} take @param {Partial<TakeRecord>} patch */
  const update = (take, patch) => {
    const current = record(take)
    if (current === null) throw new Error(`Take ${take} does not exist.`)
    writeFileSync(recordFile(take), `${JSON.stringify({ ...current, ...patch }, null, 2)}\n`)
  }

  /**
   * Keep images you attached to a prompt of the take.
   *
   * @param {string} take
   * @param {ReadonlyArray<{ name: string, mimeType: TakeImage["mimeType"], bytes: Uint8Array }>} attached
   * @returns {TakeImage[]} the images added, in order
   */
  const addImages = (take, attached) => {
    if (attached.length === 0) return []
    const current = record(take)
    if (current === null) throw new Error(`Take ${take} does not exist.`)
    const kept = current.images ?? []
    mkdirSync(imageFolder(take), { recursive: true })
    const added = attached.map((image, index) => {
      const file = `${kept.length + index + 1}.${IMAGE_TYPES[image.mimeType].extension}`
      writeFileSync(safeTakePath(join(imageFolder(take), file)), image.bytes)
      return { file, name: image.name, mimeType: image.mimeType }
    })
    update(take, { images: [...kept, ...added] })
    return added
  }

  /**
   * The bytes of one image of the take, or null when the take has no such image.
   *
   * @param {string} take
   * @param {string} file as `TakeImage.file` names it
   * @returns {{ image: TakeImage, bytes: Buffer } | null}
   */
  const image = (take, file) => {
    const known = record(take)?.images?.find(candidate => candidate.file === file)
    if (known === undefined) return null
    const path = safeTakePath(join(imageFolder(take), known.file))
    return existsSync(path) ? { image: known, bytes: readFileSync(path) } : null
  }

  /** @param {string} file @returns {string | null} */
  const original = file => {
    const path = join(root, fence(file))
    // A folder is not a file the code pane can open.
    return existsSync(path) && !lstatSync(path).isDirectory() ? readFileSync(path, "utf8") : null
  }

  /** Remove an edited copy, so the take uses the original again. @param {string} take @param {string} file */
  const reset = (take, file) => {
    const inside = fence(file)
    const copy = safeTakePath(join(folder(take), inside))
    if (symlinkEscape(folder(take), copy) !== null) throw new Error(`"${file}" leaves take ${take}.`)
    rmSync(copy, { force: true })
  }

  /**
   * A project file as the take sees it: the take's copy when it has one,
   * else the real file.
   *
   * @param {string} take
   * @param {string} file
   */
  const read = (take, file) => {
    const inside = fence(file)
    const copy = safeTakePath(join(folder(take), inside))
    if (existsSync(copy) && symlinkEscape(folder(take), copy) !== null) throw new Error(`"${file}" leaves take ${take}.`)
    const source = existsSync(copy) ? copy : join(root, inside)
    if (!existsSync(source)) throw new Error(`"${inside}" does not exist.`)
    if (lstatSync(source).isDirectory()) throw new Error(`"${inside}" is a folder. Use list_files.`)
    return readFileSync(source, "utf8")
  }

  /**
   * Write the take's copy of a project file. The real file does not change.
   *
   * @param {string} take
   * @param {string} file
   * @param {string} content
   * @returns {string} the root-relative file
   */
  const write = (take, file, content) => {
    const inside = fence(file)
    const base = folder(take)
    if (!existsSync(base)) throw new Error(`Take ${take} does not exist.`)
    const copy = safeTakePath(join(base, inside))
    mkdirSync(dirname(copy), { recursive: true })
    // The take folder is Caliper's own; a link inside it could still point out.
    const real = relative(realpathSync(base), realpathSync(dirname(copy)))
    if (real.startsWith("..") || isAbsolute(real) || symlinkEscape(base, copy) !== null) throw new Error(`"${inside}" leaves take ${take}.`)
    writeFileSync(copy, content)
    return inside
  }

  /**
   * The files the take changes, root-relative, sorted.
   *
   * @param {string} take
   * @returns {string[]}
   */
  const files = take => {
    const base = folder(take)
    if (!existsSync(base)) return []
    return readdirSync(base, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => relative(base, join(entry.parentPath, entry.name)).split(sep).join("/"))
      .sort()
  }

  /**
   * Copy the take's files over the real files, then remove the take.
   *
   * @param {string} take
   * @returns {string[]} the real files that changed
   */
  const accept = take => {
    const accepting = record(take)
    // Decision 45: a workspace compares ideas. Promote, a later slice, goes through its own gates.
    if (accepting !== null && isIdea(accepting)) throw new Error(`Take ${take} is an idea of workspace ${accepting.subject.workspace}. Ideas cannot be accepted.`)
    const changed = files(take)
    for (const file of changed) {
      const inside = fence(file)
      mkdirSync(dirname(join(root, inside)), { recursive: true })
      cpSync(join(folder(take), inside), join(root, inside))
    }
    if (accepting !== null) {
      const entry = { take, created: accepting.created, part: accepting.part, state: accepting.state, files: changed, at: Date.now() }
      writeFileSync(acceptedFile(), `${JSON.stringify([...accepted(), entry].slice(-MAX_ACCEPTED), null, 2)}\n`)
    }
    discard(take)
    return changed
  }

  const acceptedFile = () => safeTakePath(join(root, CALIPER_DIR, "accepted.json"))

  /**
   * The accept log, oldest first. A damaged file or entry is skipped, not an
   * error: the log only feeds a warning.
   * @returns {AcceptRecord[]}
   */
  const accepted = () => {
    const file = acceptedFile()
    if (!existsSync(file)) return []
    try {
      const entries = JSON.parse(readFileSync(file, "utf8"))
      return Array.isArray(entries) ? entries.filter(entry => Check(AcceptRecordSchema, entry)) : []
    } catch {
      return []
    }
  }

  /**
   * Start a new take as a copy of another: every file the source changes,
   * and none of its images. The source does not change. On failure no
   * half-copied take remains.
   *
   * @param {string} source
   * @param {NewTakeRecord} ask the new take's record
   * @returns {string} the new take number
   */
  const fork = (source, ask) => {
    if (record(source) === null) throw new Error(`Take ${source} does not exist.`)
    const edited = files(source).map(file => ({ file, content: read(source, file) }))
    const take = create(ask)
    try {
      for (const { file, content } of edited) write(take, file, content)
    } catch (error) {
      discard(take)
      throw error
    }
    return take
  }

  /** @param {string} take */
  const discard = take => {
    const metadata = recordFile(take)
    rmSync(folder(take), { recursive: true, force: true })
    rmSync(imageFolder(take), { recursive: true, force: true })
    rmSync(metadata, { force: true })
  }

  /**
   * The project files a take can read under `under`, with the files the take
   * adds. Git decides what counts in a checkout; otherwise Caliper walks the
   * folder and skips dot-folders.
   *
   * @param {string} take
   * @param {string} under a root-relative folder, or "" for the whole project
   * @returns {string[]} sorted
   */
  const listFiles = (take, under) => {
    const prefix = under === "" || under === "." ? "" : `${fence(under)}/`
    const all = new Set([...(gitFiles(root) ?? walkFiles(root)), ...files(take)])
    return [...all]
      .filter(file => file.startsWith(prefix) && fenceProjectPath(root, file)._tag === "Inside")
      .sort()
  }

  return { root, list, create, fork, record, update, addImages, image, original, reset, read, write, files, listFiles, accept, accepted, discard }
}

/** @typedef {ReturnType<typeof createTakeStore>} TakeStore */

/**
 * @param {string} root
 * @returns {string[] | null} null outside a Git checkout
 */
function gitFiles(root) {
  try {
    const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    })
    return output.split("\0").filter(file => file !== "" && existsSync(join(root, file)))
  } catch {
    return null
  }
}

/**
 * Every file under `root`, skipping dot-folders and node_modules without
 * entering them.
 *
 * @param {string} root
 */
function walkFiles(root) {
  /** @type {string[]} */
  const found = []
  /** @param {string} folder root-relative, "" for the root */
  const walk = folder => {
    for (const entry of readdirSync(join(root, folder), { withFileTypes: true })) {
      const file = folder === "" ? entry.name : `${folder}/${entry.name}`
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") walk(file)
      else if (entry.isFile()) found.push(file)
    }
  }
  walk("")
  return found
}
