import { describe, expect, test } from "bun:test"
import { DRAFT_MAX, DRAFT_MIN, DRAFT_SHARE, draftHeight } from "../src/client/ui/layout"
import { nextLetter, readMarks } from "../src/client/ui/fixtures/markup"
import { createScenario } from "../src/client/ui/fixtures/scenario"
import { draftView, markView, sendingView, takesView } from "../src/client/ui/fixtures/views"
import type { ChromeView } from "../src/client/ui/contract"

const tiny = 0.01
const ready = (view: ChromeView) => {
  if (view.markup._tag !== "Ready") throw new Error("The fixture's markup is not ready")
  return view.markup
}

describe("draftHeight: the draft's share of the chrome's height", () => {
  test("a cap on a tall chrome, a share in between, a floor on a short one", () => {
    const capAt = DRAFT_MAX / DRAFT_SHARE
    const floorAt = DRAFT_MIN / DRAFT_SHARE
    expect(draftHeight(capAt + tiny)).toBe(DRAFT_MAX)
    expect(draftHeight(capAt - 1)).toBeCloseTo((capAt - 1) * DRAFT_SHARE)
    expect(draftHeight(floorAt + 1)).toBeCloseTo((floorAt + 1) * DRAFT_SHARE)
    expect(draftHeight(floorAt - tiny)).toBe(DRAFT_MIN)
    // The phone of the mockup, 640 px tall: the draft keeps well under half of it.
    expect(draftHeight(40)).toBeLessThan(20)
  })
})

describe("letters: A to Z, then AA, AB (planner choice 5)", () => {
  test("the next free letter", () => {
    expect(nextLetter([])).toBe("A")
    expect(nextLetter(["A", "B"])).toBe("C")
    expect(nextLetter(["B"])).toBe("A")
    const alphabet = Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index))
    expect(nextLetter(alphabet)).toBe("AA")
    expect(nextLetter([...alphabet, "AA"])).toBe("AB")
    expect(nextLetter([...alphabet, ...alphabet.map(letter => `A${letter}`)])).toBe("BA")
  })
})

describe("the gallery's local markup follows the shared Send policy", () => {
  test("a lost mark blocks the whole pass and names why", () => {
    const markup = ready(draftView())
    expect(markup.send._tag).toBe("Idle")
    if (markup.send._tag !== "Idle") return
    expect(markup.send.availability._tag).toBe("Disabled")
    expect(markup.send.label).toBe("Send · 4 new takes")
    expect(markup.groups.find(group => group.source.take === "3")?.decision._tag).toBe("Blocked")
    expect(markup.groups.find(group => group.source.take === "6")?.decision._tag).toBe("Ready")
  })
  test("placing a mark adds the next letter on that take, opens its note and moves the revision", () => {
    const scenario = createScenario(markView())
    const before = ready(scenario.getView())
    scenario.actions.onMarkPoint("6@2026-09-29T13:06", { x: 10, y: 20 })
    const after = ready(scenario.getView())
    const six = after.groups.find(group => group.source.take === "6")
    expect(six?.marks.map(mark => mark.name)).toEqual(["6A", "6B", "6C"])
    expect(after.revision).toBe(before.revision + 1)
    expect(after.editor._tag === "Open" && after.editor.name).toBe("6C")
    const frame = scenario.getView().canvas
    expect(frame._tag === "Frames" && frame.frames.find(item => item.take === "6")?.marks.length).toBe(3)
  })
  test("the real files take no mark, and mark mode off places nothing", () => {
    const scenario = createScenario(markView())
    scenario.actions.onMarkPoint("real", { x: 10, y: 20 })
    scenario.actions.onMarkMode(false)
    scenario.actions.onMarkPoint("1@2026-09-29T13:01", { x: 10, y: 20 })
    expect(readMarks(scenario.getView()).length).toBe(readMarks(markView()).length)
  })
  test("Send with a stale revision does nothing; while Send runs the draft is locked", () => {
    const scenario = createScenario(takesView())
    scenario.actions.onMarkMode(true)
    scenario.actions.onMarkPoint("6@2026-09-29T13:06", { x: 10, y: 20 })
    const revision = ready(scenario.getView()).revision
    scenario.actions.onSend(revision - 1)
    expect(ready(scenario.getView()).send._tag).toBe("Idle")
    scenario.actions.onSend(revision)
    expect(ready(scenario.getView()).send._tag).toBe("Sending")
    const locked = ready(sendingView())
    expect(locked.mode._tag).toBe("Off")
    expect(locked.groups.flatMap(group => group.marks).every(mark => mark.edit._tag === "Disabled" && mark.remove._tag === "Disabled")).toBe(true)
  })
})
