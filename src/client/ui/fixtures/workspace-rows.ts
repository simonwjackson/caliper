/**
 * Local input fixtures for workspaces slice 2: a scratch row that a row agent
 * writes, and its checks in every cell, as docs/design/mockups/workspaces-rows/
 * draws them. The board is Pico's real workspace 1 and its ideas, takes 5 to
 * 7. Every cell, every check result and every image at the end of a check is
 * real (the slice 2 spike, 2026-10-01). The row agent's log and the bar's
 * words are staged. They are explicit data, not a server snapshot.
 */
import type { Availability, BoardCellView, BoardColumnView, BoardRowView, BoardView, CellChecksView, ChromeView, FrameView, LogEntry, NavPart, RowCheckView, RowRecordView, WorkspaceBarView } from "../contract"
import type { TakeRun } from "../../../types"
import { PICO_ROWS_BOARD } from "./pico-rows-board"

const enabled: Availability = { _tag: "Enabled" }
const blocked = (reason: string): Availability => ({ _tag: "Disabled", reason })

/** A page that shows one render filling the device's CSS viewport. A data URL keeps the fixture free of any server route. */
function imagePage(image: string): string {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#000}img{display:block;width:100vw;height:100vh;object-fit:contain;image-rendering:pixelated}</style></head><body><img alt="" src="${image}"></body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

const ROW_FILE = ".caliper/workspaces/1/rows/1.part.tsx"
const DPAD = `${ROW_FILE}#default`
type RowId = "home" | "find" | "settings" | "dpad"
const STATES: readonly (BoardRowView & { readonly id: RowId })[] = [
  { id: "home", key: "src/pages/PicoHome.page.part.tsx#default", ref: { part: "src/pages/PicoHome.page.part.tsx", state: "default" }, part: "Home", state: "Default", site: "src/pages/PicoHome.page.part.tsx", missing: false, checks: 0, scratch: null, open: false },
  { id: "find", key: "src/pages/PicoLibrary.page.part.tsx#default", ref: { part: "src/pages/PicoLibrary.page.part.tsx", state: "default" }, part: "Find", state: "Default", site: "src/pages/PicoLibrary.page.part.tsx", missing: false, checks: 0, scratch: null, open: false },
  { id: "settings", key: "src/pages/PicoSettings.page.part.tsx#default", ref: { part: "src/pages/PicoSettings.page.part.tsx", state: "default" }, part: "Settings", state: "Default", site: "src/pages/PicoSettings.page.part.tsx", missing: false, checks: 0, scratch: null, open: false },
]
type IdeaId = "5" | "6" | "7"
const IDEAS: Readonly<Record<IdeaId, { readonly name: string; readonly brief: string; readonly strange: boolean; readonly files: number }>> = {
  5: { name: "Shelf End-Cap Carts", strange: false, files: 12, brief: "Places Find and Settings directly onto the game shelf as dedicated system carts at the ends of the carousel, keeping navigation strictly 1D without vertical focus switching." },
  6: { name: "Header Destination Bar", strange: false, files: 10, brief: "Adds focusable tabs for Library, Find, and Settings into the top bar reachable via D-pad Up, displaying gamepad shortcut badges on each." },
  7: { name: "Root Back System Drawer", strange: true, files: 6, brief: "Reinterprets the root (B) Back prompt to open a lightweight System Drawer containing focusable entries for Find, Settings, and Mode cycling navigated with D-pad Up/Down and A." },
}
/** Pixel-identical to Today's render (ImageMagick compare, AE 0). */
const SAME = new Set(["7:find", "7:settings"])
const QUESTION = "A person can open Settings using only the d-pad, A and B. Today Settings opens only on the system input, which the host never sends. Find and mode cycling work on a gamepad, but no hint on screen names them. Does Find also get a focusable entry?"
const ASKED = "Home on the portal's own input: the arrow keys are the d-pad, Enter is A and Escape is B. Check that the d-pad and A open Settings, and that B returns to Home. Also check that the d-pad and A open Find."
const ROW_NAME = "Home by d-pad, A and B"

type Column = "today" | IdeaId
/** The two named checks of the row, at their real source lines, and how each went (the spike's reports). */
const CHECKS = [
  { name: "the d-pad and A open Settings, and B returns to Home", line: 62, failure: "No control named Settings is reachable with the d-pad from Home, before or after one B." },
  { name: "the d-pad and A open Find", line: 70, failure: "No control named Find is reachable with the d-pad from Home, before or after one B." },
] as const
const PASSES: Readonly<Record<Column, boolean>> = { today: false, 5: true, 6: true, 7: true }

/** The row agent's conversation, as it would read after the spike's row. Staged. */
const LOG_WRITING: readonly LogEntry[] = [
  { _tag: "User", text: ASKED, images: [] },
  { _tag: "Tool", name: "read_file", subject: "src/PicoSurface.tsx", outcome: "Done", detail: "" },
  { _tag: "Tool", name: "read_file", subject: "src/fixtures/fixture-host.ts", outcome: "Done", detail: "" },
  { _tag: "Tool", name: "read_file", subject: "../../clients/portal/src/input/keyboard-adapter.ts", outcome: "Done", detail: "" },
  { _tag: "Tool", name: "read_file", subject: "../../clients/portal/src/input/spatial-focus.ts", outcome: "Done", detail: "" },
  { _tag: "Tool", name: "write_row", subject: "rows/1.part.tsx", outcome: "Running", detail: "" },
]
const LOG_DONE: readonly LogEntry[] = [
  ...LOG_WRITING.slice(0, -1),
  { _tag: "Tool", name: "write_row", subject: "rows/1.part.tsx", outcome: "Done", detail: "84 lines" },
  { _tag: "Tool", name: "render_row", subject: "Today, rg353m, with checks", outcome: "Done", detail: "Rendered · 0 of 2 checks pass" },
  { _tag: "Assistant", text: "The row renders Pico's surface on the portal's own input bus, keyboard adapter and spatial focus. Both checks press only the arrow keys, Enter and Escape. In Today both fail: no control named Settings or Find is reachable with the d-pad. That is the gap the question names, so I left both checks as they are." },
]

type Scene = {
  /** The d-pad row: absent, being written, or written. */
  readonly row: "None" | "Writing" | "Written"
  /** How far the checks of the written row got, column by column. */
  readonly checked?: Readonly<Partial<Record<Column, "Waiting" | "Running" | "Done">>>
  /** The bar: New row, the focused row, or neither. */
  readonly bar: "NewRow" | "Row" | "More"
  /** The row's record in the side panel, unfolded at this column. */
  readonly record?: Column
}

const columnLabel = (column: Column) => column === "today" ? "Today" : column

/** The board of Pico's workspace 1, on top of a fixture view of the parts. */
export function rowsScene(base: ChromeView, scene: Scene): ChromeView {
  const run = (tag: TakeRun["_tag"]): TakeRun => ({ _tag: tag } as TakeRun)
  const columns: BoardColumnView[] = [
    { _tag: "Today", key: "today" },
    ...(["5", "6", "7"] as const).map((take): BoardColumnView => ({ _tag: "Idea", key: `idea:${take}`, take, name: IDEAS[take].name, brief: IDEAS[take].brief, strange: IDEAS[take].strange, run: run("Idle"), files: IDEAS[take].files, focused: false })),
  ]
  const written = scene.row === "Written"
  const focused = scene.bar === "Row"
  const dpad: (BoardRowView & { readonly id: RowId }) | null = scene.row === "None" ? null : {
    id: "dpad", key: DPAD, ref: { part: ROW_FILE, state: "default" }, part: written ? ROW_NAME : "Home on the portal's own input…", state: "Scratch", site: ROW_FILE, missing: false,
    checks: written ? CHECKS.length : 0, scratch: { id: "1", run: run(written ? "Idle" : "Running"), written, focused }, open: scene.record !== undefined,
  }
  const rows = [...STATES, ...dpad ? [dpad] : []]
  const frame = (row: (typeof rows)[number], take: IdeaId | null): FrameView => ({
    key: JSON.stringify(["board", row.ref.part, row.ref.state, take, take ? Number(take) : null]), label: take ? `Idea ${take}` : "Today",
    title: `${row.part} · ${row.state} · ${take ? `idea ${take}` : "the real files"}`, src: imagePage(PICO_ROWS_BOARD[take ?? "today"][row.id]),
    subject: row.ref, preview: row.ref, take, selected: false, ...(take ? { run: { _tag: "Idle" } as const } : {}),
    verdict: { _tag: "Rendered" }, problems: [], markable: blocked("A workspace compares ideas; marks are for takes."), marks: [],
  })
  const progress = (column: Column) => scene.checked?.[column]
  const checksIn = (row: (typeof rows)[number], column: Column): CellChecksView => {
    if (row.id !== "dpad" || !written) return { _tag: "None" }
    const step = progress(column)
    if (step === "Done") return { _tag: "Done", passed: PASSES[column] ? CHECKS.length : 0, total: CHECKS.length, stale: false }
    return step === "Running" ? { _tag: "Running" } : step === "Waiting" ? { _tag: "Waiting" } : { _tag: "NotRun" }
  }
  const cells: BoardCellView[] = rows.flatMap(row => columns.map((column): BoardCellView => {
    const id: Column = column._tag === "Idea" ? column.take as IdeaId : "today"
    const shown = row.id !== "dpad" || written
    return { row: row.key, column: column.key, frame: shown ? frame(row, id === "today" ? null : id) : null, same: SAME.has(`${id}:${row.id}`), checks: checksIn(row, id) }
  }))
  const record: RowRecordView = scene.record === undefined || !dpad ? { _tag: "Closed" } : {
    _tag: "Open", row: dpad.key, title: written ? ROW_NAME : "New row", file: ROW_FILE, brief: ASKED,
    scratch: { id: "1", run: run(written ? "Idle" : "Running"), stop: written ? blocked("No agent is running.") : enabled, remove: enabled },
    columns: (["today", "5", "6", "7"] as const).map(column => ({ key: column === "today" ? "today" : `idea:${column}`, label: columnLabel(column) })),
    column: scene.record === "today" ? "today" : `idea:${scene.record}`,
    checks: written ? CHECKS.map((check, index): RowCheckView => ({
      name: check.name, line: check.line,
      results: (["today", "5", "6", "7"] as const).map(column => {
        const step = progress(column)
        const status = step === "Done" ? (PASSES[column] ? "Passed" : "Failed") : step === "Running" ? "Running" : step === "Waiting" ? "Waiting" : "NotRun"
        return { column: column === "today" ? "today" : `idea:${column}`, status, detail: status === "Failed" ? check.failure : "", image: step === "Done" ? PICO_ROWS_BOARD[column].proof[index] ?? null : null }
      }),
    })) : [],
    checkAgain: written ? enabled : blocked("The row agent is still writing the row."),
    log: written ? LOG_DONE : LOG_WRITING,
  }
  const prompt = scene.bar === "NewRow" ? ASKED : ""
  const bar: WorkspaceBarView = scene.bar === "NewRow"
    ? { mode: "NewRow", prompt, placeholder: "Say what the new row shows, and what its checks press and expect", edit: enabled, count: 3, notices: [], idea: null, row: null,
      go: { label: "Write row", availability: prompt ? enabled : blocked("Say what the row must show and check first.") } }
    : scene.bar === "Row" && dpad
      ? { mode: "Row", prompt: "", placeholder: `Tell the row what to change`, edit: enabled, count: 3, notices: [], idea: null,
        row: { id: "1", label: written ? ROW_NAME : "New row", remove: enabled, stop: written ? blocked("No agent is running.") : enabled },
        go: { label: "Send to row", availability: blocked("Write what to change first.") } }
      : { mode: "More", prompt: "", placeholder: "Describe another idea for this question", edit: enabled, count: 3, notices: [], idea: null, row: null,
        go: { label: "New idea", availability: blocked("Describe the idea first.") } }
  const board: BoardView = {
    _tag: "Open", id: "1", title: "Settings and Find Navigation", status: "Open", statusLabel: "Open",
    question: QUESTION, asked: "Asked on 1 Oct.", rows, columns, cells, questions: [], ask: enabled, answer: enabled,
    discard: { availability: enabled, ideas: 3, files: 28, answered: 0, open: 0 },
    bar, newRow: enabled, record,
  }
  const pinned = (part: NavPart, state: string) => STATES.some(row => row.ref.part === part.file && row.ref.state === state)
  const parts = base.navigation.parts.map(part => ({
    ...part, selected: false, expanded: false,
    pinned: part.states.filter(state => pinned(part, state.ref.state)).length,
    states: part.states.map(state => ({ ...state, selected: false, comparing: false, takes: [], pin: { _tag: "Pin", pinned: pinned(part, state.ref.state), availability: enabled } as const })),
  }))
  return {
    ...base,
    navigation: {
      ...base.navigation, parts, scenario: { _tag: "None" },
      workspaces: { create: enabled, items: [{ id: "1", name: "Settings and Find Navigation", meta: "Open · 3 ideas", selected: true, problem: "" }] },
    },
    canvas: { _tag: "Empty", message: "The board of the workspace is on screen." },
    plan: { _tag: "None" },
    composer: { ...base.composer, prompt, follow: null },
    focusedTake: null, record: { _tag: "Closed" },
    tools: { ...base.tools, active: "takes", side: scene.record !== undefined ? "record" : "closed" },
    workspace: board,
  }
}

const DONE = { today: "Done", 5: "Done", 6: "Done", 7: "Done" } as const
/** The moments of slice 2, on top of a fixture view of the parts. */
export const ROWS_SCENES = {
  /** New row: the bar says what the row must show and check. */
  workspaceRowNew: { row: "None", bar: "NewRow" },
  /** The row agent works. The row waits at the bottom; its record shows the log. */
  workspaceRowWriting: { row: "Writing", bar: "Row", record: "today" },
  /** The row is written. Today is checked; idea 5 is checking; 6 and 7 wait. */
  workspaceRowChecking: { row: "Written", bar: "Row", checked: { today: "Done", 5: "Running", 6: "Waiting", 7: "Waiting" }, record: "today" },
  /** Every column is checked. Today fails both checks; the record shows why, and the page at each check's end. */
  workspaceRowChecked: { row: "Written", bar: "Row", checked: DONE, record: "today" },
  /** The same board with the side panel closed, for the size ladder. */
  workspaceRowBoard: { row: "Written", bar: "More", checked: DONE },
} satisfies Record<string, Scene>
