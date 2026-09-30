import { describe, expect, test } from "bun:test"
import {
  BAR_H, BAR_W, CANVAS_W, CODE_H, CODE_SHARE, DOCK_W, GUTTER, PARTS_W, RAIL_W, SIDE_W, STAGE_H, STAGE_SHARE,
  codeHeight, fitComposer, fitTools, frontSheet, planLayout,
} from "../src/client/ui/layout"

/** The Darkroom chrome keeps the browser's 16 px rem. */
const px = (value: number) => value / 16
const all = { nav: true, side: true, code: true, bar: true }
const takes = { nav: true, side: false, code: false, bar: true }
const record = { nav: true, side: true, code: false, bar: true }
const knobs = { nav: true, side: true, code: false, bar: false }
const tiny = 0.01

describe("planLayout at the mockup sizes", () => {
  test("desk 1600 × 1000: rail, parts and side as columns", () => {
    expect(planLayout(px(1600), px(1000), record)).toEqual({ tools: "rail", nav: "docked", side: "column", code: "closed" })
    expect(planLayout(px(1600), px(1000), takes)).toEqual({ tools: "rail", nav: "docked", side: "closed", code: "closed" })
  })
  test("unfolded Fold 1000 × 680: a take's record wins over the parts panel, Knobs leave room for both", () => {
    expect(planLayout(px(1000), px(680), record)).toEqual({ tools: "rail", nav: "drawer", side: "column", code: "closed" })
    expect(planLayout(px(1000), px(680), knobs)).toEqual({ tools: "rail", nav: "docked", side: "column", code: "closed" })
  })
  test("folded phone 416 × 640: dock, drawer and sheets", () => {
    expect(planLayout(px(416), px(640), all)).toEqual({ tools: "dock", nav: "drawer", side: "sheet", code: "sheet" })
  })
})

describe("planLayout thresholds, either side of each", () => {
  test("the rail becomes a dock under 44 rem", () => {
    expect(planLayout(DOCK_W, 40, takes).tools).toBe("rail")
    expect(planLayout(DOCK_W - tiny, 40, takes).tools).toBe("dock")
  })
  test("the side panel is a column while the canvas keeps its width beside it", () => {
    const edge = RAIL_W + 2 * GUTTER + SIDE_W + GUTTER + BAR_W
    expect(planLayout(edge, 40, { ...record, nav: false }).side).toBe("column")
    expect(planLayout(edge - tiny, 40, { ...record, nav: false }).side).toBe("sheet")
    const noBar = RAIL_W + 2 * GUTTER + SIDE_W + GUTTER + CANVAS_W
    expect(planLayout(noBar, 40, { ...knobs, nav: false }).side).toBe("column")
    expect(planLayout(noBar - tiny, 40, { ...knobs, nav: false }).side).toBe("sheet")
  })
  test("the parts panel docks while the canvas keeps its width after the side column", () => {
    const edge = RAIL_W + 2 * GUTTER + SIDE_W + GUTTER + PARTS_W + GUTTER + BAR_W
    expect(planLayout(edge, 40, record).nav).toBe("docked")
    expect(planLayout(edge - tiny, 40, record).nav).toBe("drawer")
    const noSide = RAIL_W + 2 * GUTTER + PARTS_W + GUTTER + BAR_W
    expect(planLayout(noSide, 40, takes).nav).toBe("docked")
    expect(planLayout(noSide - tiny, 40, takes).nav).toBe("drawer")
  })
  test("the code pane sits under the canvas while the canvas keeps half the height and its floor", () => {
    // Without the bar the canvas floor binds first: 10 rem of code and 12 rem of canvas.
    const alone = CODE_H + STAGE_H
    expect(planLayout(60, alone, { ...all, bar: false }).code).toBe("below")
    expect(planLayout(60, alone - tiny, { ...all, bar: false }).code).toBe("sheet")
    // With the bar the half-height rule binds: half the height must hold the pane's floor and the bar.
    const withBar = (CODE_H + BAR_H) / (1 - STAGE_SHARE)
    expect(planLayout(60, withBar, all).code).toBe("below")
    expect(planLayout(60, withBar - tiny, all).code).toBe("sheet")
  })
  test("the code pane's height follows the dragged share inside its floor and the canvas's half", () => {
    expect(codeHeight(62.5, CODE_SHARE, false)).toBeCloseTo(28.75)
    expect(codeHeight(62.5, CODE_SHARE, true)).toBeCloseTo(62.5 / 2 - BAR_H)
    expect(codeHeight(62.5, 0.8, false)).toBeCloseTo(31.25)
    expect(codeHeight(62.5, 0.05, false)).toBe(CODE_H)
  })
  test("closed regions stay closed at every size", () => {
    const none = { nav: false, side: false, code: false, bar: false }
    for (const [width, height] of [[100, 62.5], [62.5, 42.5], [26, 40], [80, 18.75], [15, 11.25]] as const) {
      expect(planLayout(width, height, none)).toMatchObject({ nav: "closed", side: "closed", code: "closed" })
    }
  })
})

describe("planLayout across the size ladder keeps every open region reachable", () => {
  const ladder = {
    generous: [px(1920), px(1200)], medium: [px(960), px(1000)], "narrow-tall": [px(390), px(900)],
    "wide-short": [px(1280), px(300)], tiny: [px(240), px(180)],
  } as const
  for (const [name, [width, height]] of Object.entries(ladder)) {
    test(name, () => {
      const plan = planLayout(width, height, all)
      expect(plan.nav).not.toBe("closed")
      expect(plan.side).not.toBe("closed")
      expect(plan.code).not.toBe("closed")
      if (plan.tools === "dock") expect([plan.nav, plan.side, plan.code]).toEqual(["drawer", "sheet", "sheet"])
    })
  }
  test("a wide-short strip spends its width: rail and columns, code as a sheet", () => {
    expect(planLayout(px(1280), px(300), all)).toEqual({ tools: "rail", nav: "docked", side: "column", code: "sheet" })
  })
})

describe("frontSheet: a pressed tool names the sheet in front", () => {
  const both = planLayout(px(416), px(640), all)
  test("each tool names its own sheet", () => {
    expect(frontSheet(both, "code", "record")).toBe("code")
    expect(frontSheet(both, "takes", "record")).toBe("side")
    expect(frontSheet(both, "knobs", "knobs")).toBe("side")
  })
  test("Preview means the canvas with nothing over it", () => {
    expect(frontSheet(both, "preview", "record")).toBe(null)
    expect(frontSheet(both, "preview", "knobs")).toBe(null)
  })
  test("a tool whose sheet is not open puts nothing in front", () => {
    expect(frontSheet(both, "takes", "knobs")).toBe(null)
    expect(frontSheet(both, "knobs", "record")).toBe(null)
    expect(frontSheet({ ...both, code: "closed" }, "code", "record")).toBe(null)
    expect(frontSheet(both, "checks", "record")).toBe(null)
  })
  test("columns are never in front: only sheets compete", () => {
    const desk = planLayout(px(1600), px(1000), all)
    expect(frontSheet(desk, "takes", "record")).toBe(null)
  })
})

describe("fitComposer", () => {
  const input = { field: 256, gap: 10, take: 290, go: 120 }
  const inline = 290 + 256 + 120 + 20
  test("one row while the prompt keeps its width beside the take and the go group", () => {
    expect(fitComposer(inline, input)).toBe("Inline")
    expect(fitComposer(inline - 1, input)).toBe("TakeAbove")
  })
  test("the take moves above before the well stacks", () => {
    expect(fitComposer(256 + 120 + 10, input)).toBe("TakeAbove")
    expect(fitComposer(256 + 120 + 10 - 1, input)).toBe("Stacked")
  })
  test("no focused take takes no room and no gap", () => {
    expect(fitComposer(256 + 120 + 10, { ...input, take: 0 })).toBe("Inline")
    expect(fitComposer(256 + 120 + 9, { ...input, take: 0 })).toBe("Stacked")
  })
})

describe("fitTools", () => {
  const tools = ["parts", "preview", "takes", "code", "knobs", "checks", "calibrate"].map(id => ({ id, size: 52 }))
  const input = { tools, gap: 0, more: 52, overflowOrder: ["calibrate", "checks", "knobs", "code"] }
  test("every tool inline while they fit", () => {
    expect(fitTools(7 * 52, input)).toEqual({ inline: tools.map(tool => tool.id), overflow: [] })
  })
  test("tools move into More in order, and More takes a slot", () => {
    // The menu lists them in the tools' own order.
    expect(fitTools(7 * 52 - 1, input).overflow).toEqual(["checks", "calibrate"])
    expect(fitTools(6 * 52, input).overflow).toEqual(["checks", "calibrate"])
    expect(fitTools(6 * 52 - 1, input).overflow).toEqual(["knobs", "checks", "calibrate"])
  })
  test("no tool is removed: inline and overflow together are every tool, in order", () => {
    for (const length of [0, 100, 200, 300, 400]) {
      const fit = fitTools(length, input)
      expect([...fit.inline, ...fit.overflow].sort()).toEqual(tools.map(tool => tool.id).sort())
    }
  })
})
