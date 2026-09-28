// @ts-check

/**
 * Where the chrome's regions go, as a pure function of the chrome's own box.
 * chrome.js applies the plan as data attributes on `.cal`; chrome.css mirrors
 * the sizes below. Every threshold is a guess until measured on a real desk.
 *
 * The preview is the product. It keeps at least half the height under the
 * bar, so at most one pane stacks under it. When the whole set of panes
 * (parts, preview, code, takes) cannot be shown at once without that, the
 * chrome switches to tabs: one of preview, code or takes fills the work
 * area, and the bar switches between them. Nothing is removed at any size;
 * a pane only moves one tap away.
 *
 * @typedef {"docked" | "drawer"} NavPlace
 *   docked: a column at the left. drawer: over the work area, opened from the bar.
 * @typedef {"column" | "below" | "tab" | "closed"} TakesPlace
 * @typedef {"beside" | "below" | "tab" | "closed"} CodePlace
 * @typedef {{ nav: NavPlace, takes: TakesPlace, code: CodePlace, tabs: boolean }} LayoutPlan
 * @typedef {{ code: boolean, takes: boolean }} OpenPanes
 */

// Sizes are in rem, as chrome.css writes them. The chrome's rem is 15 px at
// the browser's default font size (chrome.css sets 0.9375rem on the root).

/** The docked part list: `--cal-nav-width` is `clamp(14rem, 20%, 18rem)`. */
export const NAV_W = 14
const NAV_SHARE = 0.2
const NAV_MAX = 18
/** The narrowest stage worth showing a device in. */
export const STAGE_W = 20
/** The Takes column: `--cal-takes-width` is `clamp(22rem, 28%, 26rem)`. */
export const TAKES_W = 22
const TAKES_W_SHARE = 0.28
const TAKES_MAX = 26
/** The narrowest code pane beside the stage (chrome.css: `minmax(22rem, …)`). */
export const CODE_W = 22
/** One row of the bar. */
export const BAR_H = 3
/** The shortest stage (`--cal-stage-min`). */
export const STAGE_H = 12
/** The shortest code pane under the stage (`--cal-code-min`). */
export const CODE_H = 9
/** The shortest Takes panel: its header, one take and the prompt with its buttons. */
export const TAKES_H = 15
/** The shortest docked part list. */
export const NAV_H = 10
/** Takes under the stage get this share of the height under the bar (chrome.css: `--cal-takes-share`). */
export const TAKES_SHARE = 0.4
/** The code pane's default share of the work area (chrome.js DEFAULT_CODE_SHARE). */
export const CODE_SHARE = 0.45
/** The stage keeps at least this share of the height under the bar. */
export const STAGE_SHARE = 0.5

/**
 * Docked arrangements of the parts and the takes, most preferred first. Width
 * is spent before height: the parts and the takes stay columns while they fit.
 *
 * @type {ReadonlyArray<{ nav: NavPlace, takes: "column" | "below" }>}
 */
const DOCKED = [
  { nav: "docked", takes: "column" },
  { nav: "docked", takes: "below" },
  { nav: "drawer", takes: "column" },
  { nav: "drawer", takes: "below" },
]

/** The code pane's places beside docked panes. */
const CODE_PLACES = /** @type {const} */ (["beside", "below"])

/** Devices are landscape handhelds; the stage is judged by the largest frame of this shape it holds. */
const FRAME_ASPECT = 4 / 3
/** A frame this wide is roomy: the code pane may sit beside it, where code reads best. */
const FRAME_ROOMY = 30

/**
 * The stage an arrangement leaves, or null when it cannot give every open
 * pane its minimum and keep the stage's share.
 *
 * @param {{ nav: NavPlace, takes: TakesPlace, code: CodePlace }} arrangement
 * @param {number} width
 * @param {number} height
 * @returns {{ width: number, height: number } | null}
 */
function stageFor(arrangement, width, height) {
  const { nav, takes, code } = arrangement
  const column = height - BAR_H
  const clamp = (/** @type {number} */ min, /** @type {number} */ value, /** @type {number} */ max) => Math.min(max, Math.max(min, value))
  const mainWidth = width
    - (nav === "docked" ? clamp(NAV_W, NAV_SHARE * width, NAV_MAX) : 0)
    - (takes === "column" ? clamp(TAKES_W, TAKES_W_SHARE * width, TAKES_MAX) : 0)
  const stageWidth = mainWidth - (code === "beside" ? Math.max(CODE_W, CODE_SHARE * mainWidth) : 0)
  if (stageWidth < STAGE_W) return null
  if (nav === "docked" && column < NAV_H) return null
  if (takes === "column" && column < TAKES_H) return null
  const takesHeight = takes === "below" ? Math.max(TAKES_H, TAKES_SHARE * column) : 0
  const work = column - takesHeight
  if (code === "below" && work * CODE_SHARE < CODE_H) return null
  const stageHeight = code === "below" ? work * (1 - CODE_SHARE) : work
  if (stageHeight < STAGE_H || stageHeight < STAGE_SHARE * column) return null
  return { width: stageWidth, height: stageHeight }
}

/** The width of the largest device frame a stage holds. @param {{ width: number, height: number }} stage */
const frameWidth = stage => Math.min(stage.width, stage.height * FRAME_ASPECT)

/**
 * Place the open panes in one docked arrangement. The code pane sits beside
 * the stage, where code reads best, while the stage there still holds a roomy
 * frame; otherwise it goes where it leaves the larger frame. Null when
 * nothing fits.
 *
 * @param {{ nav: NavPlace, takes: "column" | "below" }} arrangement
 * @param {number} width
 * @param {number} height
 * @param {OpenPanes} open
 * @returns {LayoutPlan | null}
 */
function place(arrangement, width, height, open) {
  const takes = open.takes ? arrangement.takes : /** @type {const} */ ("closed")
  if (!open.code) return stageFor({ nav: arrangement.nav, takes, code: "closed" }, width, height) ? { nav: arrangement.nav, takes, code: "closed", tabs: false } : null
  const [beside, below] = CODE_PLACES.map(code => {
    const stage = stageFor({ nav: arrangement.nav, takes, code }, width, height)
    return stage ? frameWidth(stage) : null
  })
  const code = beside != null && (beside >= FRAME_ROOMY || below == null || beside >= below) ? "beside"
    : below != null ? "below"
    : null
  return code ? { nav: arrangement.nav, takes, code, tabs: false } : null
}

/**
 * Where each region goes.
 *
 * Tabs are decided from the box alone, as if every pane were open, so
 * opening or closing a pane never flips the chrome between tabs and docked
 * panes. Within docked panes, only the open ones are placed.
 *
 * @param {number} width the chrome's width in rem
 * @param {number} height the chrome's height in rem
 * @param {OpenPanes} open
 * @returns {LayoutPlan}
 */
export function planLayout(width, height, open) {
  const all = { code: true, takes: true }
  const docked = DOCKED.some(arrangement => place(arrangement, width, height, all) !== null)
  if (!docked) {
    const nav = stageFor({ nav: "docked", takes: "closed", code: "closed" }, width, height) ? "docked" : "drawer"
    return { nav, takes: "tab", code: "tab", tabs: true }
  }
  for (const arrangement of DOCKED) {
    const plan = place(arrangement, width, height, open)
    if (plan) return plan
  }
  // Unreachable: the full set fits, so every subset of it fits.
  return { nav: "drawer", takes: open.takes ? "column" : "closed", code: open.code ? "below" : "closed", tabs: false }
}

/**
 * @typedef {{ id: string, width: number }} BarGroup
 *   A group of bar controls that moves as one. `width` is its natural width.
 * @typedef {{ rows: 1 | 2, overflow: string[] }} BarPlan
 */

/**
 * How the bar fits its width. The ladder: everything on one row; then the
 * title (a readout) gets its own row; then groups move into the More menu,
 * in the given order, until the controls fit one row.
 *
 * @param {number} width the bar's content width
 * @param {{ lead: number, title: number, gap: number, more: number, groups: BarGroup[], overflowOrder: string[] }} input
 *   `lead` is the width before the title (the Parts button, or 0);
 *   `title` the narrowest the title may get on a shared row.
 * @returns {BarPlan}
 */
export function fitBar(width, { lead, title, gap, more, groups, overflowOrder }) {
  const row = (/** @type {number[]} */ widths) => widths.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, widths.length - 1)
  const all = groups.map(group => group.width)
  const heading = row(lead > 0 ? [lead, title] : [title])
  if (heading + gap + row(all) <= width) return { rows: 1, overflow: [] }
  if (row(all) <= width) return { rows: 2, overflow: [] }
  /** @type {string[]} */
  const overflow = []
  for (const id of overflowOrder) {
    overflow.push(id)
    const inline = [...groups.filter(group => !overflow.includes(group.id)).map(group => group.width), more]
    if (heading + gap + row(inline) <= width) return { rows: 1, overflow }
    if (row(inline) <= width) return { rows: 2, overflow }
  }
  return { rows: 2, overflow }
}
