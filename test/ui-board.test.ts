import { describe, expect, test } from "bun:test"
import { COLUMN_HEAD, COMPACT_HEAD, FLOOR_SCALE, FRAME_H, FRAME_W, GAP, MIN_SCALE, PICKER_H, ROW_HEAD, ROW_PICK_W, planBoard } from "./plan-board"
import type { BoardPlan } from "./plan-board"

const BOARD = { columns: 4, rows: 3 }
/** The width at which `columns` cells fit at `scale`. */
const widthFor = (columns: number, scale: number) => columns * FRAME_W * scale + GAP * (columns - 1)
const TALL = 2000
const shown = (plan: BoardPlan) => plan.columns._tag === "All" ? BOARD.columns : plan.columns._tag === "Pair" ? 2 : 1
const pickerH = (plan: BoardPlan) => plan.columns._tag === "All" ? 0 : PICKER_H

describe("planBoard", () => {
  test("every column at true size when the board is wide enough", () => {
    expect(planBoard(widthFor(4, 1), TALL, BOARD)).toEqual({ columns: { _tag: "All" }, rows: { _tag: "Stack" }, scale: 1 })
  })

  test("every column, scaled, down to the smallest useful scale", () => {
    const plan = planBoard(widthFor(4, MIN_SCALE), TALL, BOARD)
    expect(plan.columns._tag).toBe("All")
    expect(plan.scale).toBeCloseTo(MIN_SCALE)
  })

  test("one pixel narrower, Today and one idea instead of shrinking further", () => {
    const plan = planBoard(widthFor(4, MIN_SCALE) - 1, TALL, BOARD)
    expect(plan.columns._tag).toBe("Pair")
    expect(plan.scale).toBeGreaterThanOrEqual(MIN_SCALE)
  })

  test("one column when two do not fit at the smallest useful scale", () => {
    expect(planBoard(widthFor(2, MIN_SCALE) - 1, TALL, BOARD).columns._tag).toBe("One")
  })

  test("rows stack while one whole row fits under the column names", () => {
    const height = COLUMN_HEAD + ROW_HEAD + FRAME_H
    expect(planBoard(widthFor(4, 1), height, BOARD).rows._tag).toBe("Stack")
    expect(planBoard(widthFor(4, 1), height - 1, BOARD).rows._tag).toBe("Pick")
  })

  test("a column picker counts against the height of the first row", () => {
    const width = widthFor(2, 1)
    const height = COLUMN_HEAD + PICKER_H + ROW_HEAD + FRAME_H
    expect(planBoard(width, height, BOARD)).toMatchObject({ columns: { _tag: "Pair" }, rows: { _tag: "Stack" } })
    expect(planBoard(width, height - 1, BOARD).rows._tag).toBe("Pick")
  })

  test("a wide, short board puts the row picker beside the cells and keeps every column", () => {
    const plan = planBoard(900, 150, BOARD)
    expect(plan).toMatchObject({ columns: { _tag: "All" }, rows: { _tag: "Pick", place: "Side" } })
    expect(plan.scale).toBeGreaterThanOrEqual(MIN_SCALE)
  })

  test("a short strip keeps every column when hiding columns would not make the cells larger", () => {
    // The wide-short ladder size: about 920 by 120 for the board.
    const plan = planBoard(920, 120, BOARD)
    expect(plan).toMatchObject({ columns: { _tag: "All" }, rows: { _tag: "Pick", place: "Side" } })
    expect(plan.scale).toBeGreaterThan(0.4)
  })

  test("a narrow, short board keeps a readable pair rather than one larger cell", () => {
    // A phone-width board too short to stack a pair: 384 by 240.
    const plan = planBoard(384, 240, BOARD)
    expect(plan).toMatchObject({ columns: { _tag: "Pair" }, rows: { _tag: "Pick", place: "Top" } })
    expect(plan.scale).toBeGreaterThanOrEqual(MIN_SCALE)
  })

  test("a tiny board still shows one cell, never below the floor", () => {
    const plan = planBoard(200, 90, BOARD)
    expect(plan.columns._tag).toBe("One")
    expect(plan.rows._tag).toBe("Pick")
    expect(plan.scale).toBeGreaterThanOrEqual(FLOOR_SCALE)
  })

  test("a board of only Today never offers a pair", () => {
    expect(planBoard(200, TALL, { columns: 1, rows: 3 }).columns._tag).toBe("All")
  })

  test("at every size: no cell below the floor, stacked columns only at a useful scale, and what is drawn fits", () => {
    for (let width = 150; width <= 2400; width += 25) {
      for (let height = 60; height <= 1400; height += 20) {
        const plan = planBoard(width, height, BOARD)
        const where = `${width} x ${height}: ${JSON.stringify(plan)}`
        expect(plan.scale, where).toBeGreaterThanOrEqual(FLOOR_SCALE)
        expect(plan.scale, where).toBeLessThanOrEqual(1)
        if (plan.rows._tag === "Stack" && plan.columns._tag !== "One") expect(plan.scale, where).toBeGreaterThanOrEqual(MIN_SCALE - 1e-9)
        if (plan.scale <= FLOOR_SCALE) continue
        const side = plan.rows._tag === "Pick" && plan.rows.place === "Side" ? ROW_PICK_W : 0
        expect(widthFor(shown(plan), plan.scale) + side, where).toBeLessThanOrEqual(width + 0.01)
        const used = plan.rows._tag === "Stack"
          ? COLUMN_HEAD + pickerH(plan) + ROW_HEAD + FRAME_H * plan.scale
          : COMPACT_HEAD + pickerH(plan) + (plan.rows.place === "Top" ? PICKER_H : 0) + FRAME_H * plan.scale
        if (plan.rows._tag === "Pick" || BOARD.rows > 1) expect(used, where).toBeLessThanOrEqual(height + 0.01)
      }
    }
  })
})
