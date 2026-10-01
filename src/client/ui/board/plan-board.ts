/**
 * How the workspace board lays out its cells, as a pure function of the box
 * the board is given (intrinsic design). The mockup runs this function at
 * every size it renders, and the board's CSS takes its heights from these
 * constants, so the images and the rule are one decision.
 *
 * The board is a grid: one row for each pinned state, one column for Today
 * and one for each idea. No cell is ever removed. When columns do not fit,
 * the board shows Today beside one idea, then one column, and a picker
 * holds the others. When one row does not fit, a picker holds the rows. On
 * a short, wide board that picker stands beside the cells, so it spends the
 * width that is free instead of the height that is not.
 *
 * Sizes are CSS px. Every threshold is a guess until it is measured in the
 * real chrome.
 */

/** One RG353M frame at true size on the calibrated desk: 72 mm at 3.875 px/mm. */
export const FRAME_W = 279
/** The same frame's height: 480 / 640 of its width. */
export const FRAME_H = 209
/** The gap between two cells, across and down. */
export const GAP = 16
/** While width is the limit, a cell smaller than this is too small to compare: the board shows fewer columns instead. */
export const MIN_SCALE = 0.5
/** The board never draws a cell smaller than this. A smaller box scrolls instead. */
export const FLOOR_SCALE = 0.25
/** Column names over the cells: the name, and a line for the files and the run. */
export const COLUMN_HEAD = 46
/** Column names when the rows are picked: the name only. */
export const COMPACT_HEAD = 26
/** One picker line, and the space under it. */
export const PICKER_H = 40
/** The band above a row of cells: space, and the state's name. */
export const ROW_HEAD = 34
/** A row picker that stands beside the cells, and its gap. */
export const ROW_PICK_W = 112
/** One choice in a row picker that stands beside the cells. The picker must fit beside them whole. */
export const PICK_ITEM_H = 26

export type BoardColumns =
  /** Every column side by side. */
  | { readonly _tag: "All" }
  /** Today, and one idea that a picker chooses. */
  | { readonly _tag: "Pair" }
  /** One column that a picker chooses, Today included. */
  | { readonly _tag: "One" }
export type BoardRows =
  /** Rows one under another. The board scrolls when they do not all fit. */
  | { readonly _tag: "Stack" }
  /** One row at a time, from a picker beside the cells or above them. */
  | { readonly _tag: "Pick"; readonly place: "Side" | "Top" }
export type BoardPlan = {
  readonly columns: BoardColumns
  readonly rows: BoardRows
  /** Cell width over true-size width. Below 1, the caption says the board is scaled. */
  readonly scale: number
}

/**
 * @param width the board's content width
 * @param height the board's content height, under the title and over the caption
 * @param count how many columns (Today plus each idea) and how many rows the board holds
 * @param frame one frame at true size: the device's physical size at the calibrated px per mm
 */
export function planBoard(width: number, height: number, count: { readonly columns: number; readonly rows: number }, frame: { readonly width: number; readonly height: number } = { width: FRAME_W, height: FRAME_H }): BoardPlan {
  const FRAME_W = frame.width
  const FRAME_H = frame.height
  const choices = [...new Set([count.columns, Math.min(2, count.columns), 1])]
  const shape = (columns: number): BoardColumns => columns === count.columns ? { _tag: "All" } : columns === 2 ? { _tag: "Pair" } : { _tag: "One" }
  const picker = (columns: number) => columns === count.columns ? 0 : PICKER_H
  const across = (room: number, columns: number) => (room - GAP * (columns - 1)) / (columns * FRAME_W)
  const down = (room: number) => room / FRAME_H

  // Rows stacked: the most columns that fit the width at a useful scale, if one whole row fits under them.
  const stacked = choices.find(columns => across(width, columns) >= MIN_SCALE) ?? 1
  const stackScale = Math.min(1, across(width, stacked))
  if (count.rows <= 1 || down(height - COLUMN_HEAD - picker(stacked) - ROW_HEAD) >= stackScale) {
    return { columns: shape(stacked), rows: { _tag: "Stack" }, scale: stackScale }
  }

  // Rows picked: names shrink to one line. The board exists to compare, so take the most columns
  // that stay at a useful scale, then the largest cells. When nothing reaches a useful scale,
  // height is the limit and more columns usually cost nothing: take the largest cells, and on a
  // tie the most columns, then the picker beside the cells.
  const options = choices.flatMap(columns => [
    // A side picker is its choices, a 2 px gap between them, and 8 px of padding and edge.
    { columns, place: "Side" as const, scale: height - COMPACT_HEAD - picker(columns) < count.rows * (PICK_ITEM_H + 2) + 8 ? -1
      : Math.min(1, across(width - ROW_PICK_W, columns), down(height - COMPACT_HEAD - picker(columns))) },
    { columns, place: "Top" as const, scale: Math.min(1, across(width, columns), down(height - COMPACT_HEAD - picker(columns) - PICKER_H)) },
  ])
  const largest = (list: typeof options) => list.reduce((a, b) => b.scale > a.scale + 1e-9 ? b : a)
  const useful = options.filter(option => option.scale >= MIN_SCALE)
  const most = Math.max(0, ...useful.map(option => option.columns))
  const widest = useful.length > 0 ? largest(useful.filter(option => option.columns === most)) : largest(options)
  // Below the floor every cell is drawn at the floor and the board scrolls: then one cell is the least to scroll.
  const best = widest.scale >= FLOOR_SCALE ? widest : largest(options.filter(option => option.columns === 1))
  return { columns: shape(best.columns), rows: { _tag: "Pick", place: best.place }, scale: Math.max(FLOOR_SCALE, best.scale) }
}
