// @ts-check
import { describe, expect, test } from "bun:test"
import { BAR_H, CODE_W, NAV_H, NAV_W, STAGE_W, TAKES_W, fitBar, planLayout } from "../src/client/layout.js"

const both = { code: true, takes: true }
const none = { code: false, takes: false }
/** The chrome's rem: chrome.css sets 0.9375rem on the root. */
const px = (/** @type {number} */ value) => value / 15

describe("planLayout", () => {
  test("a generous window shows every pane as a column, with code beside the stage", () => {
    expect(planLayout(px(1800), px(1000), both)).toEqual({ nav: "docked", takes: "column", code: "beside", tabs: false })
  })

  test("an unfolded Fold (wide and short) keeps three columns and puts code under the stage", () => {
    expect(planLayout(px(1030), px(572), both)).toEqual({ nav: "docked", takes: "column", code: "below", tabs: false })
  })

  test("a folded Fold switches to tabs with the part list in a drawer", () => {
    expect(planLayout(px(412), px(660), both)).toEqual({ nav: "drawer", takes: "tab", code: "tab", tabs: true })
    expect(planLayout(px(412), px(524), both)).toEqual({ nav: "drawer", takes: "tab", code: "tab", tabs: true })
  })

  test("a tall phone uses tabs too: the stage never shares its height with two panes", () => {
    expect(planLayout(px(390), px(844), both).tabs).toBe(true)
    expect(planLayout(px(390), px(2000), both).tabs).toBe(true)
  })

  test("tabs do not depend on which panes are open", () => {
    for (const open of [both, none, { code: true, takes: false }, { code: false, takes: true }]) {
      expect(planLayout(px(412), px(660), open)).toEqual({ nav: "drawer", takes: "tab", code: "tab", tabs: true })
      expect(planLayout(px(1030), px(572), open).tabs).toBe(false)
    }
  })

  test("docked panes switch to tabs one rem either side of the narrowest docked width", () => {
    const edge = STAGE_W + TAKES_W
    expect(planLayout(edge, 60, both).tabs).toBe(false)
    expect(planLayout(edge - 0.07, 60, both).tabs).toBe(true)
  })

  test("a short window spends its width: takes and code stay columns, the parts become a drawer", () => {
    const width = NAV_W + STAGE_W + CODE_W + TAKES_W - 1
    expect(planLayout(width, px(300), both)).toEqual({ nav: "drawer", takes: "column", code: "beside", tabs: false })
  })

  test("code sits beside the stage only when the stage keeps its width next to the code pane's share", () => {
    expect(planLayout(px(1200), px(800), both)).toEqual({ nav: "docked", takes: "column", code: "below", tabs: false })
    expect(planLayout(px(1600), px(800), both)).toEqual({ nav: "docked", takes: "column", code: "beside", tabs: false })
  })

  test("code goes under a narrow stage when that frames the device larger", () => {
    // Beside, the stage would be 335 px wide; below, it frames the device at about 620 px.
    expect(planLayout(px(1280), px(900), both)).toEqual({ nav: "docked", takes: "column", code: "below", tabs: false })
    // In a short strip the code pane has no room under the stage, so it stays beside.
    expect(planLayout(px(1280), px(300), both).code).toBe("beside")
  })

  test("a wide strip keeps everything as columns while its height allows", () => {
    expect(planLayout(px(1280), px(300), both)).toEqual({ nav: "docked", takes: "column", code: "beside", tabs: false })
  })

  test("closed panes give their room back: the parts dock again", () => {
    expect(planLayout(px(755), px(1000), both)).toEqual({ nav: "drawer", takes: "column", code: "below", tabs: false })
    expect(planLayout(px(755), px(1000), none)).toEqual({ nav: "docked", takes: "closed", code: "closed", tabs: false })
  })

  test("with tabs, the parts dock when the width pays for them", () => {
    expect(planLayout(px(700), px(340), both)).toEqual({ nav: "docked", takes: "tab", code: "tab", tabs: true })
    expect(planLayout(NAV_W + STAGE_W - 0.07, NAV_H + BAR_H + 1, both).nav).toBe("drawer")
  })

  test("the stage keeps at least half the height under the bar", () => {
    // 700 px wide: takes as a column and code under the stage need a 397 px window at 16 px, 372 px at 15 px.
    const docked = planLayout(px(700), px(400), both)
    expect(docked).toEqual({ nav: "drawer", takes: "column", code: "below", tabs: false })
    expect(planLayout(px(700), px(300), both).tabs).toBe(true)
  })
})

describe("fitBar", () => {
  const groups = [
    { id: "devices", width: 200 },
    { id: "calibrate", width: 90 },
    { id: "views", width: 190 },
  ]
  const input = { lead: 0, title: 160, gap: 8, more: 44, groups, overflowOrder: ["calibrate", "devices"] }
  const controls = 200 + 90 + 190 + 16

  test("one row when the title keeps its minimum beside every control", () => {
    expect(fitBar(160 + 8 + controls, input)).toEqual({ rows: 1, overflow: [] })
  })

  test("the title takes its own row before any control moves to the menu", () => {
    expect(fitBar(160 + 8 + controls - 1, input)).toEqual({ rows: 2, overflow: [] })
    expect(fitBar(controls, input)).toEqual({ rows: 2, overflow: [] })
  })

  test("Calibrate moves to the menu first, then the devices", () => {
    expect(fitBar(controls - 1, input)).toEqual({ rows: 2, overflow: ["calibrate"] })
    expect(fitBar(200 + 190 + 44 + 16 - 1, input)).toEqual({ rows: 1, overflow: ["calibrate", "devices"] })
    expect(fitBar(300, input)).toEqual({ rows: 2, overflow: ["calibrate", "devices"] })
  })

  test("once groups are in the menu, the bar goes back to one row if the title fits", () => {
    expect(fitBar(160 + 8 + 190 + 8 + 44, { ...input, groups: [{ id: "devices", width: 600 }, { id: "calibrate", width: 90 }, { id: "views", width: 190 }] }))
      .toEqual({ rows: 1, overflow: ["calibrate", "devices"] })
  })

  test("the views never move to the menu", () => {
    expect(fitBar(100, input).overflow).not.toContain("views")
  })

  test("the Parts button shares the title's row", () => {
    expect(fitBar(160 + 8 + controls, { ...input, lead: 70 })).toEqual({ rows: 2, overflow: [] })
    expect(fitBar(70 + 8 + 160 + 8 + controls, { ...input, lead: 70 })).toEqual({ rows: 1, overflow: [] })
  })
})
