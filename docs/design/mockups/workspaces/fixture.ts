/**
 * The workspace the mockup draws, and the seven moments of slice 1.
 *
 * Every cell is a real render of Pico on the RG353M: Today is the real files,
 * and ideas 1 to 3 are the edits in ideas/<n>.diff, rendered through
 * Caliper's take overlay with caliper-render. "Same as Today" is a byte
 * comparison of those PNGs, not a guess.
 */
import today_home from "./cells/today/home.png"
import today_find from "./cells/today/find.png"
import today_settings from "./cells/today/settings.png"
import one_home from "./cells/1/home.png"
import one_find from "./cells/1/find.png"
import one_settings from "./cells/1/settings.png"
import two_home from "./cells/2/home.png"
import two_find from "./cells/2/find.png"
import two_settings from "./cells/2/settings.png"
import three_home from "./cells/3/home.png"
import three_find from "./cells/3/find.png"
import three_settings from "./cells/3/settings.png"

export type RowId = "home" | "find" | "settings"
export type IdeaId = "1" | "2" | "3"
export type ColumnId = "today" | IdeaId

export type Row = { readonly id: RowId; readonly part: string; readonly state: string; readonly file: string }
export const ROWS: readonly Row[] = [
  { id: "home", part: "Home", state: "Default", file: "src/pages/PicoHome.page.part.tsx" },
  { id: "find", part: "Find", state: "Default", file: "src/pages/PicoLibrary.page.part.tsx" },
  { id: "settings", part: "Settings", state: "Default", file: "src/pages/PicoSettings.page.part.tsx" },
]

export type Idea = {
  readonly id: IdeaId; readonly name: string; readonly brief: string; readonly strange: boolean
  readonly files: readonly string[]
}
export const IDEAS: readonly Idea[] = [
  { id: "1", name: "A row of places under the shelf", strange: false,
    brief: "Put Find and Settings in one row under the shelf. D-pad down from the carts reaches it. The header and the hint bar stay as they are.",
    files: ["src/pages/PicoHome.tsx", "src/pages/PicoHome.css"] },
  { id: "2", name: "Places in every header", strange: false,
    brief: "Put Find and Settings in the header of every catalog screen, beside the clock. D-pad up reaches them from any screen. The place you are in is marked.",
    files: ["src/ui/molecules/PicoStatusBar.tsx", "src/ui/molecules/PicoStatusBar.css"] },
  { id: "3", name: "Settings is a cart", strange: true,
    brief: "Stand Settings and Find on the shelf as carts, before the games. The shelf becomes the only menu.",
    files: ["src/pages/PicoHome.tsx", "src/ui/organisms/PicoCartShelf.tsx"] },
]

const CELLS: Record<ColumnId, Record<RowId, string>> = {
  today: { home: today_home, find: today_find, settings: today_settings },
  1: { home: one_home, find: one_find, settings: one_settings },
  2: { home: two_home, find: two_find, settings: two_settings },
  3: { home: three_home, find: three_find, settings: three_settings },
}
/** Byte-identical to Today's render (cmp on the PNGs). */
const SAME = new Set(["1:find", "1:settings", "3:find", "3:settings"])
export const cellOf = (column: ColumnId, row: RowId) => CELLS[column][row]
export const sameAsToday = (column: ColumnId, row: RowId) => column !== "today" && SAME.has(`${column}:${row}`)

export type Question =
  | { readonly _tag: "Open"; readonly id: string; readonly text: string; readonly by: string }
  | { readonly _tag: "Answered"; readonly id: string; readonly text: string; readonly answer: string; readonly reason: string; readonly by: string }

export const WORKSPACE = {
  name: "Settings with the d-pad",
  question: "A person can open Settings using only the d-pad, A and B. Today Settings opens only on the system input, which the host never sends. Find and mode cycling work on a gamepad, but no hint names them. Does Find also get a focusable entry?",
  short: "Open Settings using only the d-pad, A and B.",
}

const ANSWERED: Question = {
  _tag: "Answered", id: "q1", by: "You",
  text: "Does Find also get a focusable entry?",
  answer: "Yes. Find gets its own entry, next to Settings.",
  reason: "Rule 6. Find opens only from the options button today, and no hint names that button.",
}
const HINTS: Question = { _tag: "Open", id: "q2", by: "You", text: "Should the hint bar also name the menu and options buttons?" }
const READOUT: Question = {
  _tag: "Open", id: "q3", by: "Idea 3",
  text: "In Settings is a cart, the readout says 7 carts and the tally says 1/9. Do Korri's places count as carts?",
}

export type IdeaRun = "Planning" | "Running" | "Ready"
export type Bar =
  | { readonly _tag: "Ask"; readonly prompt: string; readonly ready: boolean }
  | { readonly _tag: "Planning" }
  | { readonly _tag: "More" }
  | { readonly _tag: "Idea"; readonly idea: IdeaId }
export type Scene = {
  readonly title: string
  readonly rows: readonly RowId[]
  /** The ideas on the board, and how far each one is. Empty before the plan. */
  readonly ideas: readonly { readonly id: IdeaId; readonly run: IdeaRun }[]
  readonly focused: IdeaId | null
  readonly side: "Questions" | "Closed"
  readonly questions: readonly Question[]
  readonly answering: string | null
  readonly bar: Bar
  readonly dialog: "Discard" | null
  readonly pinning: boolean
}

const BASE: Scene = {
  title: WORKSPACE.name, rows: ["home", "find", "settings"], ideas: [], focused: null,
  side: "Questions", questions: [], answering: null, bar: { _tag: "More" }, dialog: null, pinning: false,
}
const READY = IDEAS.map(idea => ({ id: idea.id, run: "Ready" as const }))
const ASKED = [ANSWERED, HINTS, READOUT]

export const SCENES = {
  /** A new workspace: no question yet, no rows. */
  new: { ...BASE, title: "New workspace", rows: [], side: "Closed", bar: { _tag: "Ask", prompt: "", ready: false }, pinning: true },
  /** The question is written and three states are pinned. The real files fill the Today column. */
  frame: { ...BASE, side: "Closed", bar: { _tag: "Ask", prompt: WORKSPACE.question, ready: true }, pinning: true },
  /** The planner turns the question into three directions. */
  planning: { ...BASE, side: "Closed", ideas: IDEAS.map(idea => ({ id: idea.id, run: "Planning" as const })), bar: { _tag: "Planning" } },
  /** Each idea's agent works. Idea 1 is done. */
  running: { ...BASE, side: "Closed", ideas: [{ id: "1", run: "Ready" }, { id: "2", run: "Running" }, { id: "3", run: "Running" }], bar: { _tag: "More" } },
  /** Every idea is done. Idea 2 is focused, and the questions are open beside the board. */
  board: { ...BASE, ideas: READY, focused: "2", questions: ASKED, bar: { _tag: "Idea", idea: "2" } },
  /** You answer an open question, with the reason. */
  answer: { ...BASE, ideas: READY, focused: "2", questions: ASKED, answering: "q2", bar: { _tag: "Idea", idea: "2" } },
  /** Discard: the ideas go, the questions and answers stay. */
  discard: { ...BASE, ideas: READY, focused: "2", questions: ASKED, bar: { _tag: "Idea", idea: "2" }, dialog: "Discard" },
} satisfies Record<string, Scene>
export type SceneName = keyof typeof SCENES
