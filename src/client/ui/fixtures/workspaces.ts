/**
 * Local input fixtures for a workspace's board (decision 45), as the mockup
 * in docs/design/mockups/workspaces/ draws its moments: a new workspace, the
 * question with three pinned states, planning, ideas at work, the board with
 * the questions beside it, and a closed workspace. Every cell is a real Pico
 * render from the mockup. They are explicit data, not a server snapshot.
 */
import type { Availability, BoardCellView, BoardColumnView, BoardRowView, BoardView, ChromeView, FrameView, NavPart, QuestionView, WorkspaceBarView } from "../contract"
import type { TakeRun } from "../../../types"
import { PICO_BOARD } from "./pico-board"

const enabled: Availability = { _tag: "Enabled" }
const blocked = (reason: string): Availability => ({ _tag: "Disabled", reason })

/** A page that shows one render filling the device's CSS viewport. A data URL keeps the fixture free of any server route. */
function imagePage(image: string): string {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#000}img{display:block;width:100vw;height:100vh;object-fit:contain;image-rendering:pixelated}</style></head><body><img alt="" src="${image}"></body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

type RowId = keyof typeof PICO_BOARD.today
const ROWS: readonly (BoardRowView & { readonly id: RowId })[] = [
  { id: "home", key: "src/pages/PicoHome.page.part.tsx#default", ref: { part: "src/pages/PicoHome.page.part.tsx", state: "default" }, part: "Home", state: "Default", site: "src/pages/PicoHome.page.part.tsx", missing: false },
  { id: "find", key: "src/pages/PicoFind.page.part.tsx#default", ref: { part: "src/pages/PicoFind.page.part.tsx", state: "default" }, part: "Find", state: "Default", site: "src/pages/PicoFind.page.part.tsx", missing: false },
  { id: "settings", key: "src/pages/PicoSettings.page.part.tsx#default", ref: { part: "src/pages/PicoSettings.page.part.tsx", state: "default" }, part: "Settings", state: "Default", site: "src/pages/PicoSettings.page.part.tsx", missing: false },
]
type IdeaId = "1" | "2" | "3"
const IDEAS: Readonly<Record<IdeaId, { readonly name: string; readonly brief: string; readonly strange: boolean; readonly files: number }>> = {
  1: { name: "A row of places under the shelf", strange: false, files: 2, brief: "Put Find and Settings in one row under the shelf. D-pad down from the carts reaches it." },
  2: { name: "Places in every header", strange: false, files: 2, brief: "Put Find and Settings in the header of every catalog screen, beside the clock. D-pad up reaches them." },
  3: { name: "Settings is a cart", strange: true, files: 2, brief: "Stand Settings and Find on the shelf as carts, before the games. The shelf becomes the only menu." },
}
/** Byte-identical to Today's render in the mockup (cmp on the PNGs). */
const SAME = new Set(["1:find", "1:settings", "3:find", "3:settings"])
const QUESTION = "A person can open Settings using only the d-pad, A and B. Today Settings opens only on the system input, which the host never sends. Find and mode cycling work on a gamepad, but no hint names them. Does Find also get a focusable entry?"
const ANSWERED: QuestionView = {
  _tag: "Answered", id: "1", by: "You · 1 Oct", text: "Does Find also get a focusable entry?",
  answer: "Yes. Find gets its own entry, next to Settings.", reason: "Rule 6. Find opens only from the options button today, and no hint names that button.",
}
const HINTS: QuestionView = { _tag: "Open", id: "2", by: "You · 1 Oct", text: "Should the hint bar also name the menu and options buttons?" }
const READOUT: QuestionView = { _tag: "Open", id: "3", by: "Idea 3: Settings is a cart · 1 Oct", text: "In Settings is a cart, the readout says 7 carts and the tally says 1/9. Do Korri's places count as carts?" }

type Scene = {
  readonly status: "New" | "Open" | "Closed"
  readonly rows: readonly RowId[]
  readonly ideas: readonly { readonly take: IdeaId; readonly run: TakeRun["_tag"] }[]
  readonly planning?: number
  readonly focused?: IdeaId
  readonly questions?: readonly QuestionView[]
  readonly side?: boolean
  readonly prompt?: string
}

/** A board view and the parts panel that goes with it, on top of a fixture view of the parts. */
export function workspaceScene(base: ChromeView, scene: Scene): ChromeView {
  const open = scene.status !== "Closed"
  const rows = ROWS.filter(row => scene.rows.includes(row.id))
  const run = (tag: TakeRun["_tag"]): TakeRun => tag === "Failed" ? { _tag: "Failed", reason: "The model request failed." } : { _tag: tag }
  const columns: BoardColumnView[] = [
    { _tag: "Today", key: "today" },
    ...scene.ideas.map(({ take, run: tag }): BoardColumnView => ({ _tag: "Idea", key: `idea:${take}`, take, name: IDEAS[take].name, brief: IDEAS[take].brief, strange: IDEAS[take].strange, run: run(tag), files: IDEAS[take].files, focused: take === scene.focused })),
    ...Array.from({ length: scene.planning ?? 0 }, (_, index): BoardColumnView => ({ _tag: "Planned", key: `planned:${index}` })),
  ]
  const frame = (row: (typeof ROWS)[number], take: IdeaId | null): FrameView => ({
    key: JSON.stringify(["board", row.ref.part, row.ref.state, take, take ? Number(take) : null]), label: take ? `Idea ${take}` : "Today",
    title: `${row.part} · ${row.state} · ${take ? `idea ${take}` : "the real files"}`, src: imagePage(PICO_BOARD[take ?? "today"][row.id]),
    subject: row.ref, preview: row.ref, take, selected: take !== null && take === scene.focused, ...(take ? { run: { _tag: "Idle" } as const } : {}),
    verdict: { _tag: "Rendered" }, problems: [], markable: blocked("A workspace compares ideas; marks are for takes."), marks: [],
  })
  const cells: BoardCellView[] = rows.flatMap(row => columns.map((column): BoardCellView => {
    if (column._tag === "Today") return { row: row.key, column: column.key, frame: frame(row, null), same: false }
    if (column._tag === "Planned" || column.run._tag === "Running") return { row: row.key, column: column.key, frame: null, same: false }
    const take = column.take as IdeaId
    return { row: row.key, column: column.key, frame: frame(row, take), same: SAME.has(`${take}:${row.id}`) }
  }))
  const questions = scene.questions ?? []
  const focused = scene.focused ?? null
  const planning = (scene.planning ?? 0) > 0
  const prompt = scene.prompt ?? ""
  const mode: WorkspaceBarView["mode"] = !open ? "Closed" : focused ? "Idea" : scene.ideas.length === 0 ? "Ask" : "More"
  const goWhy = mode === "Ask" ? (rows.length === 0 || !prompt ? "Pin a state and write the question first." : "") : mode === "Idea" ? (prompt ? "" : "Write what to change first.") : mode === "More" ? (prompt ? "" : "Describe the idea first.") : "This workspace is closed."
  const bar: WorkspaceBarView = {
    mode, prompt: planning ? QUESTION : prompt, notices: [], count: 3,
    placeholder: mode === "Ask" ? "Ask the question this workspace answers" : mode === "Idea" ? `Tell idea ${focused} what to change` : mode === "Closed" ? "This workspace is closed" : "Describe another idea for this question",
    edit: open && !planning ? enabled : blocked(open ? "Ideas are being planned." : "This workspace is closed."),
    go: { label: mode === "Ask" ? "Plan 3 ideas" : mode === "Idea" ? `Send to idea ${focused}` : mode === "More" ? "New idea" : "Closed", availability: goWhy ? blocked(goWhy) : enabled },
    idea: focused ? { take: focused, label: `Idea ${focused}`, discard: enabled, stop: blocked("No agent is running.") } : null,
  }
  const answered = questions.filter(question => question._tag === "Answered").length
  const title = scene.status === "New" ? "New workspace" : "Settings with the d-pad"
  const board: BoardView = {
    _tag: "Open", id: "4", title, status: scene.status, statusLabel: scene.status === "New" ? "No question yet" : scene.status,
    question: scene.status === "New" ? "" : QUESTION, asked: scene.status === "New" ? "" : "Asked on 1 Oct.",
    rows, columns, cells, questions, ask: open ? enabled : blocked("This workspace is closed."), answer: open ? enabled : blocked("This workspace is closed."),
    discard: { availability: open ? enabled : blocked("This workspace is closed."), ideas: scene.ideas.length, files: scene.ideas.reduce((sum, idea) => sum + IDEAS[idea.take].files, 0), answered, open: questions.length - answered },
    bar,
  }
  const pinned = (part: NavPart, state: string) => rows.some(row => row.ref.part === part.file && row.ref.state === state)
  const showing = new Set(["src/pages/PicoHome.page.part.tsx", "src/pages/PicoSettings.page.part.tsx"])
  const parts = base.navigation.parts.map(part => ({
    ...part, selected: false, expanded: showing.has(part.file),
    pinned: part.states.filter(state => pinned(part, state.ref.state)).length,
    states: part.states.map(state => ({ ...state, selected: false, comparing: false, takes: [], pin: open ? { _tag: "Pin", pinned: pinned(part, state.ref.state), availability: enabled } as const : { _tag: "None" } as const })),
  }))
  const meta = !open ? "Closed · 1 answer" : scene.ideas.length === 0 ? "Open · no ideas yet" : `Open · ${scene.ideas.length} ideas`
  return {
    ...base,
    navigation: {
      ...base.navigation, parts, scenario: { _tag: "None" },
      workspaces: { create: enabled, items: [
        { id: "4", name: title, meta, selected: true, problem: "" },
        { id: "2", name: "Cart art at small sizes", meta: "Closed · 2 answers", selected: false, problem: "" },
      ] },
    },
    canvas: { _tag: "Empty", message: "The board of the workspace is on screen." },
    plan: planning ? { _tag: "Planning", count: scene.planning ?? 3, message: `Planning ${scene.planning} ideas…` } : { _tag: "None" },
    composer: { ...base.composer, prompt: bar.prompt, follow: null },
    focusedTake: null, record: { _tag: "Closed" },
    tools: { ...base.tools, active: "takes", side: scene.side ? "record" : "closed" },
    workspace: board,
  }
}

const ALL: readonly RowId[] = ["home", "find", "settings"]
const READY = [{ take: "1", run: "Idle" }, { take: "2", run: "Idle" }, { take: "3", run: "Idle" }] as const
/** The mockup's moments, on top of a fixture view of the parts. */
export const WORKSPACE_SCENES = {
  /** A new workspace: no question and no rows. Every state has a pin. */
  workspaceNew: { status: "New", rows: [], ideas: [] },
  /** The question is written and three states are pinned. The real files fill the Today column. */
  workspaceFrame: { status: "Open", rows: ALL, ideas: [], prompt: QUESTION },
  /** The planner turns the question into three ideas; their columns wait as plates. */
  workspacePlanning: { status: "Open", rows: ALL, ideas: [], planning: 3 },
  /** Idea 1 is done; ideas 2 and 3 still work. */
  workspaceRunning: { status: "Open", rows: ALL, ideas: [{ take: "1", run: "Idle" }, { take: "2", run: "Running" }, { take: "3", run: "Running" }] },
  /** Every idea is done. Idea 2 is focused, and the questions are open beside the board. */
  workspaceBoard: { status: "Open", rows: ALL, ideas: READY, focused: "2", questions: [ANSWERED, HINTS, READOUT], side: true },
  /** The ideas are discarded; the question and its answers stay. */
  workspaceClosed: { status: "Closed", rows: ALL, ideas: [], questions: [ANSWERED, HINTS, READOUT], side: true },
} satisfies Record<string, Scene>
