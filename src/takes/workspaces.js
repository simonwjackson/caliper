// @ts-check
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { Check } from "typebox/value"
import { readPart, stringExport } from "../derive/parts.js"
import { createRepoSource } from "./repo-source.js"
import { CALIPER_DIR } from "./store.js"
import { MAX_QUESTIONS, MAX_ROW, MAX_ROWS, MAX_TEXT, ROW_FILE, WORKSPACE_ID, WorkspaceSchema, rowPath } from "./workspace-contract.js"

/**
 * Workspaces of one project, on disk (decision 45):
 *
 *   <root>/.caliper/workspaces/<id>/workspace.json
 *
 * A workspace is a scratch area for one question: the rows its board shows,
 * and the questions you and the agents ask about it, with their answers. Its
 * ideas are takes whose record names the workspace, so this store does not
 * list them. Every change is a whole new file, renamed into place, so a
 * reader never sees half a workspace.
 *
 * @typedef {import("typebox").Static<typeof WorkspaceSchema>} Workspace
 * @typedef {Workspace["rows"][number]} Row
 * @typedef {Workspace["questions"][number]} Question
 * @typedef {Question["by"]} Asker
 * @typedef {Extract<Row, { _tag: "Scratch" }>} ScratchRow
 * @typedef {import("typebox").Static<typeof import("./workspace-contract.js").ScratchFactsSchema>} ScratchFacts
 * @typedef {{ _tag: "Read", workspace: Workspace, scratch: ScratchFacts[] } | { _tag: "Damaged", id: string, reason: string }} Listed
 */

export const WORKSPACES_DIR = `${CALIPER_DIR}/workspaces`

/** @param {string} root absolute Vite root */
export function createWorkspaceStore(root) {
  const folder = join(root, WORKSPACES_DIR)

  /** Workspace storage, like take storage, never goes through a link. @param {string} path */
  const unlinked = path => {
    let current = root
    for (const segment of relative(root, path).split(sep)) {
      current = join(current, segment)
      const stat = lstatSync(current, { throwIfNoEntry: false })
      if (stat?.isSymbolicLink()) throw new Error(`Unsafe symbolic link in workspace storage: ${current}.`)
      if (!stat) break
    }
    return path
  }

  /** @param {string} id */
  const fileOf = id => {
    if (!WORKSPACE_ID.test(id)) throw new Error(`"${id}" is not a workspace number.`)
    return unlinked(join(folder, id, "workspace.json"))
  }
  /** @param {string} id */
  const shown = id => `${WORKSPACES_DIR}/${id}/workspace.json`

  /** @returns {string[]} workspace numbers, lowest first */
  const list = () => {
    if (!existsSync(unlinked(folder))) return []
    return readdirSync(folder).filter(name => WORKSPACE_ID.test(name)).sort((left, right) => Number(left) - Number(right))
  }

  /**
   * @param {string} id
   * @returns {Workspace | null} null when there is no such workspace
   */
  const read = id => {
    const file = fileOf(id)
    if (!existsSync(file)) return null
    /** @type {unknown} */
    let value
    try { value = JSON.parse(readFileSync(file, "utf8")) }
    catch { throw new Error(`${shown(id)} is not JSON. Fix or delete it.`) }
    if (!Check(WorkspaceSchema, value) || value.id !== id) throw new Error(`${shown(id)} is not a valid workspace. Fix or delete it.`)
    return value
  }

  /**
   * A scratch row's file, after checking that the workspace's record names
   * it, so no other path in the workspace folder is reachable.
   *
   * @param {Workspace} workspace
   * @param {string} file
   */
  const rowFile = (workspace, file) => {
    if (typeof file !== "string" || !ROW_FILE.test(file)) throw new Error(`"${file}" is not a row file. A row file is rows/<n>.part.tsx.`)
    if (!workspace.rows.some(row => row._tag === "Scratch" && row.file === file)) throw new Error(`Workspace ${workspace.id} has no row ${file}.`)
    return unlinked(join(folder, workspace.id, file))
  }

  /**
   * What each scratch row's file declares, read without running it.
   *
   * @param {Workspace} workspace
   * @returns {ScratchFacts[]}
   */
  const scratchFacts = workspace => workspace.rows.flatMap(/** @returns {ScratchFacts[]} */ row => {
    if (row._tag !== "Scratch") return []
    const path = rowFile(workspace, row.file)
    if (!existsSync(path)) return [{ file: row.file, written: false, name: null, checks: [], problems: [] }]
    const source = readFileSync(path, "utf8")
    const part = readPart(root, rowPath(workspace.id, row.file), source)
    const checks = (part.authoredChecks?.default ?? []).map(check => ({ name: check.name, line: check.line }))
    return [{ file: row.file, written: true, name: stringExport(source, "name")?.slice(0, 200) ?? null, checks, problems: [...part.authoredCheckProblems ?? []] }]
  })

  /** @returns {Listed[]} every workspace, and the ones that cannot be read */
  const overview = () => list().flatMap(/** @returns {Listed[]} */ id => {
    try {
      const workspace = read(id)
      return workspace === null ? [] : [{ _tag: "Read", workspace, scratch: scratchFacts(workspace) }]
    } catch (error) {
      return [{ _tag: "Damaged", id, reason: error instanceof Error ? error.message : String(error) }]
    }
  })

  /**
   * Every written scratch row of every workspace, as a part whose file is
   * relative to the project root. Discovery never lists them (decision 18);
   * frames, check runs and the render tool add them where a row is asked for.
   *
   * @returns {import("../types").Part[]}
   */
  const rowParts = () => overview().flatMap(entry => entry._tag !== "Read" ? [] : entry.workspace.rows.flatMap(row => {
    if (row._tag !== "Scratch") return []
    const path = join(folder, entry.workspace.id, row.file)
    if (!existsSync(path)) return []
    return [readPart(root, rowPath(entry.workspace.id, row.file), readFileSync(path, "utf8"))]
  }))

  /** @param {Workspace} workspace */
  const save = workspace => {
    if (!Check(WorkspaceSchema, workspace)) throw new Error("Caliper made an invalid workspace. Nothing was saved.")
    const file = fileOf(workspace.id)
    mkdirSync(unlinked(join(folder, workspace.id)), { recursive: true })
    const ignore = unlinked(join(root, CALIPER_DIR, ".gitignore"))
    if (!existsSync(ignore)) writeFileSync(ignore, "# Caliper's takes. Nothing here belongs in Git.\n*\n")
    const partial = unlinked(`${file}.${process.pid}.tmp`)
    writeFileSync(partial, `${JSON.stringify(workspace, null, 2)}\n`)
    renameSync(partial, file)
    return workspace
  }

  /**
   * An open workspace, for a change.
   * @param {string} id
   */
  const open = id => {
    const workspace = read(id)
    if (workspace === null) throw new Error(`Workspace ${id} does not exist.`)
    if (workspace.status._tag === "Closed") throw new Error(`Workspace ${id} is closed. A closed workspace keeps its questions and answers, and changes no more.`)
    return workspace
  }

  /** @param {string} value @param {string} what */
  const written = (value, what) => {
    const trimmed = value.trim()
    if (trimmed === "") throw new Error(`The ${what} is empty.`)
    if (trimmed.length > MAX_TEXT) throw new Error(`The ${what} is longer than ${MAX_TEXT} characters.`)
    return trimmed
  }

  /**
   * Start a workspace. The question can be empty; you write it before the plan.
   *
   * @param {string} question
   */
  const create = question => {
    mkdirSync(unlinked(folder), { recursive: true })
    const used = list().map(Number)
    const id = String(Math.max(0, ...used) + 1)
    return save({ id, created: Date.now(), question: question.trim().slice(0, MAX_TEXT), status: { _tag: "Open" }, rows: [], questions: [] })
  }

  /** @param {string} id @param {string} question */
  const setQuestion = (id, question) => save({ ...open(id), question: written(question, "question") })

  /** @param {string} id @param {string} name a few words, from the planner */
  const setName = (id, name) => save({ ...open(id), name: written(name, "name").slice(0, 80) })

  /**
   * Add a row. A state already on the board stays where it is.
   *
   * @param {string} id
   * @param {{ part: string, state: string }} row
   */
  const pin = (id, row) => {
    const workspace = open(id)
    const pinned = { _tag: /** @type {const} */ ("State"), part: row.part, state: row.state }
    if (workspace.rows.some(other => sameRow(other, pinned))) return workspace
    if (workspace.rows.length >= MAX_ROWS) throw new Error(`A board holds at most ${MAX_ROWS} rows. Unpin one first.`)
    return save({ ...workspace, rows: [...workspace.rows, pinned] })
  }

  /** Take a pinned state off the board. Scratch rows stay. @param {string} id @param {{ part: string, state: string }} row */
  const unpin = (id, row) => {
    const workspace = open(id)
    const pinned = { _tag: /** @type {const} */ ("State"), part: row.part, state: row.state }
    return save({ ...workspace, rows: workspace.rows.filter(other => !sameRow(other, pinned)) })
  }

  /**
   * Add a scratch row at the end of the board, for a row agent to write.
   * Caliper names its file now, so the record names the row before the file
   * exists. A number in use, in the record or on disk, is never given again.
   *
   * @param {string} id
   * @param {string} brief what you asked the row agent
   * @returns {{ row: ScratchRow, workspace: Workspace }}
   */
  const addScratch = (id, brief) => {
    const workspace = open(id)
    if (workspace.rows.length >= MAX_ROWS) throw new Error(`A board holds at most ${MAX_ROWS} rows. Remove one first.`)
    const rows = unlinked(join(folder, id, "rows"))
    const onDisk = existsSync(rows) ? readdirSync(rows) : []
    const used = [...workspace.rows.flatMap(row => row._tag === "Scratch" ? [row.file] : []), ...onDisk.map(name => `rows/${name}`)]
      .flatMap(file => ROW_FILE.test(file) ? [Number(file.slice(5, -9))] : [])
    /** @type {ScratchRow} */
    const row = { _tag: "Scratch", file: `rows/${Math.max(0, ...used) + 1}.part.tsx`, brief: written(brief, "brief") }
    return { row, workspace: save({ ...workspace, rows: [...workspace.rows, row] }) }
  }

  /**
   * Write a scratch row's file: the only file a row agent writes. The whole
   * file is renamed into place, so a frame never loads half a row.
   *
   * @param {string} id
   * @param {string} file the row's file, rows/<n>.part.tsx
   * @param {string} content
   */
  const writeRow = (id, file, content) => {
    const workspace = open(id)
    const path = rowFile(workspace, file)
    if (typeof content !== "string") throw new Error("A row file is text.")
    if (content.length > MAX_ROW) throw new Error(`The row file is longer than ${MAX_ROW} characters.`)
    mkdirSync(unlinked(join(folder, id, "rows")), { recursive: true })
    const partial = unlinked(`${path}.${process.pid}.tmp`)
    writeFileSync(partial, content)
    renameSync(partial, path)
    return file
  }

  /** A scratch row's file as it is now, or null before its agent writes it. @param {string} id @param {string} file */
  const readRow = (id, file) => {
    const workspace = read(id)
    if (workspace === null) throw new Error(`Workspace ${id} does not exist.`)
    const path = rowFile(workspace, file)
    return existsSync(path) ? readFileSync(path, "utf8") : null
  }

  /** Take a scratch row off the board and delete its file. @param {string} id @param {string} file */
  const removeScratch = (id, file) => {
    const workspace = open(id)
    const path = rowFile(workspace, file)
    const saved = save({ ...workspace, rows: workspace.rows.filter(row => !(row._tag === "Scratch" && row.file === file)) })
    rmSync(path, { force: true })
    return saved
  }

  /**
   * Add an open question.
   *
   * @param {string} id
   * @param {string} text
   * @param {Asker} by
   */
  const ask = (id, text, by) => {
    const workspace = open(id)
    if (workspace.questions.length >= MAX_QUESTIONS) throw new Error(`A workspace holds at most ${MAX_QUESTIONS} questions.`)
    const next = String(Math.max(0, ...workspace.questions.map(question => Number(question.id))) + 1)
    return save({ ...workspace, questions: [...workspace.questions, { _tag: "Open", id: next, text: written(text, "question"), by, asked: Date.now() }] })
  }

  /**
   * Answer an open question, with the reason.
   *
   * @param {string} id
   * @param {string} question
   * @param {string} answer
   * @param {string} reason
   */
  const answer = (id, question, answer, reason) => {
    const workspace = open(id)
    const found = workspace.questions.find(candidate => candidate.id === question)
    if (found === undefined) throw new Error(`Workspace ${id} has no question ${question}.`)
    if (found._tag === "Answered") throw new Error(`Question ${question} is already answered.`)
    const answered = { _tag: /** @type {const} */ ("Answered"), id: found.id, text: found.text, by: found.by, asked: found.asked, answer: written(answer, "answer"), reason: written(reason, "reason"), at: Date.now() }
    return save({ ...workspace, questions: workspace.questions.map(candidate => candidate.id === question ? answered : candidate) })
  }

  /**
   * Close the workspace. The caller discards its ideas first; the question,
   * the rows and every question and answer stay.
   *
   * @param {string} id
   */
  const close = id => save({ ...open(id), status: { _tag: "Closed", at: Date.now(), promoted: [] } })

  const source = createRepoSource(root)
  return {
    root, list, read, overview, rowParts, create, setQuestion, setName, pin, unpin, ask, answer, close,
    addScratch, writeRow, readRow, removeScratch, readSource: source.readSource, listSource: source.listSource, sourceRoot: source.sourceRoot,
  }
}

/** @typedef {ReturnType<typeof createWorkspaceStore>} WorkspaceStore */

/**
 * Every written scratch row of the project, as parts (see the store's `rowParts`).
 *
 * @param {string} root
 */
export function rowParts(root) {
  return createWorkspaceStore(root).rowParts()
}

/** @param {Row} left @param {Row} right */
export function sameRow(left, right) {
  if (left._tag === "Scratch") return right._tag === "Scratch" && left.file === right.file
  if (right._tag === "Scratch") return false
  return left.part === right.part && left.state === right.state
}
