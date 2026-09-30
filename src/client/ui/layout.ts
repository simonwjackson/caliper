/**
 * Where the Darkroom chrome's regions go, as a pure function of the chrome's
 * own box (decisions 22 and 34). Sizes are in rem. The chrome's root keeps the
 * browser's 16 px rem, the same rem the Darkroom mockup was drawn in, so the
 * mockup's sizes are the chrome's sizes. Every threshold is a guess until it is
 * measured on a real desk and a real Fold.
 *
 * Regions:
 * - tools: a rail at the left, or a dock at the bottom.
 * - nav, the parts panel: a column at the left, or a drawer over the room.
 * - side, Knobs or a take's record: a column at the right, or a sheet over the
 *   lower half of the canvas.
 * - code: a pane under the canvas, or a sheet over its lower half.
 * - the composer bar: under the canvas when the view has one. It never moves.
 *
 * A sheet is never taller than half the room, so the canvas keeps its share.
 * The active tool decides which sheet is in front (`frontSheet`); a sheet that
 * is not in front stays mounted behind, one tap away on the rail or dock.
 */

export const REM_PX = 16
/** The rail's width. */
export const RAIL_W = 3
/** The one gutter: the room's edge to a panel, and a panel to the next. */
export const GUTTER = 1
/** The parts panel's width. */
export const PARTS_W = 16.5
/** The side panel's width. */
export const SIDE_W = 21
/** Narrower than this, the rail becomes a dock and every panel becomes a drawer or a sheet. */
export const DOCK_W = 44
/** The narrowest canvas worth docking a panel beside: one 72 mm frame at 96 dpi is 17 rem. */
export const CANVAS_W = 18
/** The narrowest canvas that holds the composer bar on one or two rows beside docked panels. */
export const BAR_W = 24
/** The canvas keeps at least this share of the room's height. */
export const STAGE_SHARE = 0.5
/** The shortest canvas worth showing a frame in. */
export const STAGE_H = 12
/** The code pane's default share of the room's height. */
export const CODE_SHARE = 0.46
/** The shortest useful code pane: tabs, its head and a few lines. */
export const CODE_H = 10
/** The composer bar on one row, with its gutter. */
export const BAR_H = 4.5
/** A sheet's largest share of the room's height. */
export const SHEET_SHARE = 0.5

export type ToolsPlace = "rail" | "dock"
export type NavPlace = "docked" | "drawer" | "closed"
export type SidePlace = "column" | "sheet" | "closed"
export type CodePlace = "below" | "sheet" | "closed"
export type LayoutPlan = {
  readonly tools: ToolsPlace; readonly nav: NavPlace; readonly side: SidePlace; readonly code: CodePlace
}
/** What the view has open. `bar`: the canvas shows the composer bar under it. */
export type OpenRegions = { readonly nav: boolean; readonly side: boolean; readonly code: boolean; readonly bar: boolean }

/**
 * Place the regions. Width is spent before height: the side panel wins over
 * the parts panel, because a take's record or a knob is what you act on, and
 * the parts panel is one tap away in its drawer.
 *
 * @param width the chrome's width in rem
 * @param height the chrome's height in rem
 */
export function planLayout(width: number, height: number, open: OpenRegions): LayoutPlan {
  if (width < DOCK_W) {
    return {
      tools: "dock",
      nav: open.nav ? "drawer" : "closed",
      side: open.side ? "sheet" : "closed",
      code: open.code ? "sheet" : "closed",
    }
  }
  const canvasMin = open.bar ? BAR_W : CANVAS_W
  const room = width - RAIL_W - 2 * GUTTER
  const sideColumn = open.side && room - (SIDE_W + GUTTER) >= canvasMin
  const beside = room - (sideColumn ? SIDE_W + GUTTER : 0)
  const navDocked = open.nav && beside - (PARTS_W + GUTTER) >= canvasMin
  return {
    tools: "rail",
    nav: open.nav ? (navDocked ? "docked" : "drawer") : "closed",
    side: open.side ? (sideColumn ? "column" : "sheet") : "closed",
    code: open.code ? (codeFitsBelow(height, open.bar) ? "below" : "sheet") : "closed",
  }
}

/** The code pane sits under the canvas when its shortest useful height fits beside the bar and the canvas's share. */
function codeFitsBelow(height: number, bar: boolean): boolean {
  const budget = height * (1 - STAGE_SHARE) - (bar ? BAR_H : 0)
  return budget >= CODE_H && height - CODE_H - (bar ? BAR_H : 0) >= STAGE_H
}

/**
 * The code pane's height under the canvas, in rem: the share you dragged,
 * clamped so the pane keeps its floor and the canvas keeps half the height.
 */
export function codeHeight(height: number, share: number, bar: boolean): number {
  const budget = height * (1 - STAGE_SHARE) - (bar ? BAR_H : 0)
  return Math.max(CODE_H, Math.min(share * height, budget))
}

export type Sheet = "side" | "code" | null
/**
 * The sheet in front: the one the active tool names. Code names the code
 * sheet, Knobs the side sheet holding Knobs, Takes the side sheet holding a
 * take's record. Preview names none: it means the canvas with nothing over it.
 * This is the one meaning of a pressed tool on the dock.
 */
export function frontSheet(plan: LayoutPlan, active: string, side: "knobs" | "record" | "closed"): Sheet {
  if (active === "code") return plan.code === "sheet" ? "code" : null
  if (plan.side !== "sheet") return null
  if (active === "knobs" && side === "knobs") return "side"
  if (active === "takes" && side === "record") return "side"
  return null
}

export type ComposerFit = "Inline" | "TakeAbove" | "Stacked"
/**
 * How the composer fits its own width. `take` is the focused take's actions,
 * `field` the narrowest useful prompt, `go` the group with the primary button.
 *
 * - Inline: the take's actions, then one well holding the prompt and the go group.
 * - TakeAbove: the take's actions move to their own row above the well; the
 *   well keeps one row.
 * - Stacked: as TakeAbove, and inside the well the prompt takes the full width,
 *   with the attach button and the go group on a row under it.
 *
 * Nothing moves into a menu: these are the take's and the prompt's primary actions.
 *
 * @param width the bar's content width, in any unit the inputs share
 */
export function fitComposer(width: number, input: { readonly field: number; readonly gap: number; readonly take: number; readonly go: number }): ComposerFit {
  const row = (sizes: readonly number[]) => {
    const present = sizes.filter(size => size > 0)
    return present.reduce((sum, size) => sum + size, 0) + input.gap * Math.max(0, present.length - 1)
  }
  if (row([input.take, input.field, input.go]) <= width) return "Inline"
  if (row([input.field, input.go]) <= width) return "TakeAbove"
  return "Stacked"
}

export type ToolFit = { readonly inline: readonly string[]; readonly overflow: readonly string[] }
/**
 * Which tools stay on the rail or dock, and which move into its More menu.
 * Tools move whole, in `overflowOrder`, until the rest and the More button fit.
 * A tool is never removed: overflow is one tap away, with its real label.
 *
 * @param length the rail's height or the dock's width, less its fixed lead
 */
export function fitTools(length: number, input: {
  readonly tools: readonly { readonly id: string; readonly size: number }[]
  readonly gap: number; readonly more: number; readonly overflowOrder: readonly string[]
}): ToolFit {
  const row = (sizes: readonly number[]) => sizes.reduce((sum, size) => sum + size, 0) + input.gap * Math.max(0, sizes.length - 1)
  const ids = input.tools.map(tool => tool.id)
  if (row(input.tools.map(tool => tool.size)) <= length) return { inline: ids, overflow: [] }
  const overflow: string[] = []
  for (const id of input.overflowOrder) {
    if (!ids.includes(id)) continue
    overflow.push(id)
    const inline = input.tools.filter(tool => !overflow.includes(tool.id))
    if (row([...inline.map(tool => tool.size), input.more]) <= length) break
  }
  return { inline: ids.filter(id => !overflow.includes(id)), overflow: ids.filter(id => overflow.includes(id)) }
}
