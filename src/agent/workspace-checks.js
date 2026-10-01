// @ts-check
import { createHash } from "node:crypto"
import { rowRef } from "../takes/workspace-contract.js"

/**
 * Checks in a workspace's cells (decision 45, slice 2). The board runs only
 * the authored checks of its rows: one column at a time, every row of that
 * column with checks in one run, one run at a time for the project. A
 * result keeps the source revision it ran on, so it goes out of date when
 * the row, the idea or the project changes. Results live in memory.
 *
 * @typedef {import("../types").StateRef} StateRef
 * @typedef {import("../types").CellCheck} CellCheck
 * @typedef {import("../authored/contract.js").AuthoredCase} AuthoredCase
 * @typedef {{ epoch: string, generation: number }} Stamp
 * @typedef {{ revision: Stamp, rows: Array<{ ref: StateRef, failure: string | null, checks: AuthoredCase[] }> }} ColumnRun
 * @typedef {{ status: CellCheck["status"], reason: string, results: CellCheck["results"], revision: Stamp | null }} Cell
 * @typedef {{ workspace: string, take: string | null, rows: StateRef[], device: string }} Job
 */

/** How long a column's source stamp is reused while views are built. */
const STAMP_MS = 1000

/**
 * A check's failure as its author wrote it: the driver wraps an assertion as
 * `page.evaluate: AssertionError: <message>: expected ...`.
 *
 * @param {string} detail
 */
export function checkDetail(detail) {
  const line = detail.split("\n")[0] ?? ""
  const assertion = /(?:^|: )AssertionError: (.*?)(?:: expected .*)?$/.exec(line)
  if (assertion?.[1]) return assertion[1]
  return line.replace(/^(?:page\.evaluate: )?(?:Error: )?/, "")
}

/**
 * @param {{
 *   workspaces: Pick<import("./host-types").AgentWorkspaces, "read" | "overview">,
 *   ideas: () => Promise<ReadonlyArray<{ workspace: string, take: string, device: string, run: { _tag: string } }>>,
 *   run: (job: { take: string | null, rows: StateRef[], device: string, signal: AbortSignal }) => Promise<ColumnRun>,
 *   stamp: (take: string | null) => Promise<Stamp>,
 *   parts?: () => Promise<readonly import("../types").Part[]>,
 *   onChange: () => void,
 * }} input
 *   `run` runs the authored checks of some rows in one column: Today (take
 *   null) or an idea. `stamp` is a column's source revision now. `parts` are
 *   the project's parts, for pinned states whose part declares checks.
 */
export function createWorkspaceChecks({ workspaces, ideas, run, stamp, parts = async () => [], onChange }) {
  /** @type {Map<string, Cell>} */
  const cells = new Map()
  /** @type {Job[]} */
  const queue = []
  /** @type {Map<string, string>} image key -> file */
  const images = new Map()
  /** The device each workspace last checked on, for an idea that stops. @type {Map<string, string>} */
  const devices = new Map()
  /** @type {Map<string, { at: number, value: Promise<Stamp> }>} */
  const stamps = new Map()
  let running = false
  let closed = false
  /** Requests still reading which rows and columns to check. */
  let scheduling = 0
  const shutdown = new AbortController()
  /** @param {() => Promise<void>} work */
  const schedule = work => {
    scheduling += 1
    void work().catch(() => {}).finally(() => { scheduling -= 1; onChange() })
  }

  /** @param {string} workspace @param {StateRef} ref @param {string} column @param {string} device */
  const keyOf = (workspace, ref, column, device) => JSON.stringify([workspace, ref.part, ref.state, column, device])
  /** @param {string} file */
  const imageKey = file => {
    const key = createHash("sha256").update(file).digest("hex").slice(0, 24)
    images.set(key, file)
    return key
  }

  /**
   * The rows of a workspace that declare checks, as the part and state they render.
   *
   * @param {string} workspace
   * @returns {Promise<StateRef[]>}
   */
  const checkedRows = async workspace => {
    const entry = (await workspaces.overview()).find(item => item._tag === "Read" && item.workspace.id === workspace)
    if (entry === undefined || entry._tag !== "Read") return []
    const known = await parts()
    return entry.workspace.rows.flatMap(row => {
      if (row._tag === "Scratch") return entry.scratch.some(facts => facts.file === row.file && facts.checks.length > 0) ? [rowRef(workspace, row)] : []
      return (known.find(part => part.file === row.part)?.authoredChecks?.[row.state]?.length ?? 0) > 0 ? [rowRef(workspace, row)] : []
    })
  }

  /** @param {Job} job */
  const enqueue = job => {
    if (closed || job.rows.length === 0) return
    for (const ref of job.rows) cells.set(keyOf(job.workspace, ref, job.take ?? "today", job.device), { status: "Waiting", reason: "", results: [], revision: null })
    // A newer request for the same column and device replaces a waiting one.
    const same = queue.findIndex(other => other.workspace === job.workspace && other.take === job.take && other.device === job.device)
    if (same >= 0) {
      const merged = [...new Map([...(queue[same]?.rows ?? []), ...job.rows].map(ref => [`${ref.part}#${ref.state}`, ref])).values()]
      queue[same] = { ...job, rows: merged }
    } else queue.push(job)
    onChange()
    void drain()
  }

  const drain = async () => {
    if (running) return
    running = true
    try {
      for (let job = queue.shift(); job !== undefined && !closed; job = queue.shift()) {
        const column = job.take ?? "today"
        for (const ref of job.rows) cells.set(keyOf(job.workspace, ref, column, job.device), { status: "Running", reason: "", results: [], revision: null })
        onChange()
        try {
          const done = await run({ take: job.take, rows: job.rows, device: job.device, signal: shutdown.signal })
          for (const row of done.rows) {
            cells.set(keyOf(job.workspace, row.ref, column, job.device), row.failure !== null
              ? { status: "Unknown", reason: row.failure, results: [], revision: done.revision }
              : {
                status: "Done", reason: "", revision: done.revision,
                results: row.checks.map(check => ({
                  name: check.name, line: check.source.line, status: check.status,
                  detail: check.status === "Passed" ? "" : checkDetail(check.detail),
                  image: check.image ? imageKey(check.image) : null,
                })),
              })
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          for (const ref of job.rows) cells.set(keyOf(job.workspace, ref, column, job.device), { status: "Unknown", reason, results: [], revision: null })
        }
        onChange()
      }
    } finally {
      running = false
    }
  }

  /**
   * The columns whose agent is idle: Today, and each idea of the workspace that does not work now.
   *
   * @param {string} workspace
   */
  const idleColumns = async workspace => [null, ...(await ideas()).filter(idea => idea.workspace === workspace && idea.run._tag !== "Running").map(idea => idea.take)]

  /**
   * A row agent stopped: check its row in every idle column.
   *
   * @param {string} workspace @param {string} file @param {string} device
   */
  const rowDone = (workspace, file, device) => schedule(async () => {
    const ref = rowRef(workspace, { _tag: "Scratch", file, brief: "" })
    if (!(await checkedRows(workspace)).some(row => row.part === ref.part)) return
    if (device) devices.set(workspace, device)
    const on = device || devices.get(workspace) || ""
    for (const take of await idleColumns(workspace)) enqueue({ workspace, take, rows: [ref], device: on })
  })

  /**
   * Check again: one row in every idle column.
   *
   * @param {string} workspace @param {StateRef} ref @param {string} device
   */
  const checkRow = (workspace, ref, device) => schedule(async () => {
    devices.set(workspace, device)
    for (const take of await idleColumns(workspace)) enqueue({ workspace, take, rows: [ref], device })
  })

  /**
   * An agent stopped. When it was an idea's, check every row with checks in its column.
   *
   * @param {string} take
   */
  const ideaDone = take => schedule(async () => {
    const idea = (await ideas()).find(item => item.take === take)
    if (idea === undefined || idea.run._tag === "Running") return
    const rows = await checkedRows(idea.workspace)
    enqueue({ workspace: idea.workspace, take, rows, device: devices.get(idea.workspace) ?? idea.device })
  })

  /** @param {string | null} take */
  const stampOf = take => {
    const key = take ?? ""
    const cached = stamps.get(key)
    if (cached && Date.now() - cached.at < STAMP_MS) return cached.value
    const value = stamp(take)
    stamps.set(key, { at: Date.now(), value })
    value.catch(() => stamps.delete(key))
    return value
  }

  /**
   * The cells of a workspace that have a result or wait for one, for the rows
   * and ideas it still has.
   *
   * @param {import("../types").Workspace} workspace
   * @returns {Promise<CellCheck[]>}
   */
  const cellsOf = async workspace => {
    const refs = workspace.rows.map(row => rowRef(workspace.id, row))
    const columns = new Set(["today", ...(await ideas()).filter(idea => idea.workspace === workspace.id).map(idea => idea.take)])
    /** @type {CellCheck[]} */
    const out = []
    for (const [key, cell] of cells) {
      const [owner = "", part = "", state = "", column = "", device = ""] = /** @type {string[]} */ (JSON.parse(key))
      if (owner !== workspace.id || !columns.has(column) || !refs.some(ref => ref.part === part && ref.state === state)) continue
      let stale = false
      if (cell.status === "Done" && cell.revision !== null) {
        try {
          const now = await stampOf(column === "today" ? null : column)
          stale = now.epoch !== cell.revision.epoch || now.generation !== cell.revision.generation
        } catch { stale = true }
      }
      out.push({ row: part, state, column, device, status: cell.status, reason: cell.reason, stale, results: cell.results })
    }
    return out
  }

  /** @param {string} key @returns {string | null} the file of an image at the end of a check */
  const image = key => /^[a-f0-9]{24}$/.test(key) ? images.get(key) ?? null : null

  const close = () => {
    closed = true
    queue.length = 0
    shutdown.abort(new Error("The checks are closing."))
  }

  return { rowDone, checkRow, ideaDone, cells: cellsOf, image, busy: () => running || queue.length > 0 || scheduling > 0, close }
}
