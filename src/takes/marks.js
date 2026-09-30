// @ts-check
import { randomUUID } from "node:crypto"
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Check } from "typebox/value"
import { CALIPER_DIR } from "./store.js"
import { DraftSchema, MAX_MARKS, nextLetter } from "./marks-contract.js"

/**
 * The draft of marks, on disk in `.caliper/marks.json`, so it survives a
 * chrome reload and a Vite restart, and every open chrome sees one draft.
 *
 * Every write names the revision it was made against. A write against an
 * older revision is refused with `StaleDraft`, and the chrome reloads the
 * draft. The last write wins per mark, but never over a change it has not seen.
 *
 * @typedef {import("./marks-contract.js").Draft} Draft
 * @typedef {import("./marks-contract.js").Mark} Mark
 * @typedef {import("./marks-contract.js").MarkAnchor} MarkAnchor
 */

export class StaleDraft extends Error {
  /** @param {Draft} draft */
  constructor(draft) {
    super("The draft changed in another window. Caliper reloaded it; try again.")
    this.name = "StaleDraft"
    this.draft = draft
  }
}

/** @param {string} root absolute Vite root */
export function createMarkStore(root) {
  const folder = join(root, CALIPER_DIR)
  const file = join(folder, "marks.json")

  /** Take storage rejects links; so does the draft. @param {string} path */
  const unlinked = path => {
    if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`Unsafe symbolic link in take storage: ${path}.`)
    return path
  }

  /** @returns {Draft} */
  const read = () => {
    unlinked(folder)
    if (!existsSync(unlinked(file))) return { revision: 0, marks: [] }
    /** @type {unknown} */
    let value
    try { value = JSON.parse(readFileSync(file, "utf8")) }
    catch { throw new Error(`${CALIPER_DIR}/marks.json is not JSON. Fix or delete it to start a new draft.`) }
    if (!Check(DraftSchema, value)) throw new Error(`${CALIPER_DIR}/marks.json is not a valid draft. Fix or delete it to start a new draft.`)
    return value
  }

  /** @param {number} revision @param {Mark[]} marks @returns {Draft} */
  const save = (revision, marks) => {
    const draft = { revision: revision + 1, marks }
    mkdirSync(unlinked(folder), { recursive: true })
    const ignore = unlinked(join(folder, ".gitignore"))
    if (!existsSync(ignore)) writeFileSync(ignore, "# Caliper's takes. Nothing here belongs in Git.\n*\n")
    // A reader never sees half a draft.
    const partial = unlinked(`${file}.${process.pid}.tmp`)
    writeFileSync(partial, `${JSON.stringify(draft, null, 2)}\n`)
    renameSync(partial, unlinked(file))
    return draft
  }

  /** @param {number} revision */
  const current = revision => {
    const draft = read()
    if (draft.revision !== revision) throw new StaleDraft(draft)
    return draft
  }

  /**
   * Add a mark. The draft picks its id and the next free letter on its take.
   *
   * @param {number} revision
   * @param {Omit<Mark, "id" | "letter" | "note">} mark
   * @returns {{ id: string, draft: Draft }}
   */
  const add = (revision, mark) => {
    const draft = current(revision)
    if (draft.marks.length >= MAX_MARKS) throw new Error(`A draft holds at most ${MAX_MARKS} marks. Send or remove some first.`)
    const letters = draft.marks.filter(other => sameTake(other.source, mark.source)).map(other => other.letter)
    const id = randomUUID()
    const added = { id, source: mark.source, preview: mark.preview, ...(mark.subject === undefined ? {} : { subject: mark.subject }), device: mark.device, letter: nextLetter(letters), note: "", anchor: mark.anchor }
    return { id, draft: save(draft.revision, [...draft.marks, added]) }
  }

  /**
   * Change a mark's note, or move it with a new anchor. It keeps its take,
   * preview, device and letter.
   *
   * @param {number} revision
   * @param {string} id
   * @param {{ note?: string, anchor?: MarkAnchor }} change
   */
  const change = (revision, id, change) => {
    const draft = current(revision)
    if (!draft.marks.some(mark => mark.id === id)) throw new Error("That mark is no longer in the draft.")
    return save(draft.revision, draft.marks.map(mark => mark.id === id ? {
      ...mark, ...(change.note === undefined ? {} : { note: change.note }), ...(change.anchor === undefined ? {} : { anchor: change.anchor }),
    } : mark))
  }

  /** @param {number} revision @param {string} id */
  const remove = (revision, id) => {
    const draft = current(revision)
    if (!draft.marks.some(mark => mark.id === id)) throw new Error("That mark is no longer in the draft.")
    return save(draft.revision, draft.marks.filter(mark => mark.id !== id))
  }

  /**
   * Take marks out of the draft after Send moved them into new takes.
   *
   * @param {number} revision
   * @param {ReadonlySet<string>} ids
   */
  const release = (revision, ids) => {
    const draft = current(revision)
    return save(draft.revision, draft.marks.filter(mark => !ids.has(mark.id)))
  }

  return { read, current, add, change, remove, release }
}

/** @typedef {ReturnType<typeof createMarkStore>} MarkStore */

/**
 * @param {{ take: string, created: number }} left
 * @param {{ take: string, created: number }} right
 */
export function sameTake(left, right) {
  return left.take === right.take && left.created === right.created
}
