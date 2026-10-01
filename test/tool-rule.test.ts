import { describe, expect, test } from "bun:test"
import { nextPanes, restorePanes } from "../src/client/tool-rule"
import type { Closable, Panes } from "../src/client/tool-rule"
import type { Tool } from "../src/client/ui/contract"

// The behaviour agreed on 2026-10-01 (docs/plans/react-chrome-ui-notes.md,
// "One meaning for a pressed tool on the dock"). Expected values come from
// that text and its worked example, not from the rule's code.

const fresh: Panes = restorePanes({ active: "preview", codeOpen: false, side: "closed", checksOpen: false, calibrationOpen: false })
const press = (tool: Tool, hasTake = false) => ({ _tag: "Press", tool, hasTake } as const)
const close = (pane: Closable) => ({ _tag: "Close", pane } as const)
type Event = ReturnType<typeof press> | ReturnType<typeof close>
const run = (start: Panes, ...events: readonly Event[]) => events.reduce(nextPanes, start)
/** What a person sees: the tool in front and the panes that are open. */
const seen = ({ recent: _, ...panes }: Panes) => panes

describe("closing brings back the most recent tool that is still open", () => {
  test("the worked example: Takes, then Code, then Knobs; close Knobs, then Code", () => {
    const opened = run(fresh, press("takes"), press("code"), press("knobs"))
    const knobsClosed = nextPanes(opened, close("knobs"))
    expect(seen(knobsClosed)).toEqual({ active: "code", codeOpen: true, side: "closed", checksOpen: false, calibrationOpen: false })
    expect(seen(nextPanes(knobsClosed, close("code")))).toEqual({ active: "takes", codeOpen: false, side: "closed", checksOpen: false, calibrationOpen: false })
  })
  test("a second press of the tool in front closes it the same way", () => {
    const opened = run(fresh, press("takes"), press("code"), press("knobs"))
    expect(seen(run(opened, press("knobs")))).toEqual({ active: "code", codeOpen: true, side: "closed", checksOpen: false, calibrationOpen: false })
    expect(seen(run(opened, press("knobs"), press("code")))).toEqual({ active: "takes", codeOpen: false, side: "closed", checksOpen: false, calibrationOpen: false })
  })
  test("closing Checks brings back the tool that was in front before it opened", () => {
    expect(seen(run(fresh, press("code"), press("checks"), close("checks")))).toEqual({ active: "code", codeOpen: true, side: "closed", checksOpen: false, calibrationOpen: false })
  })
  test("Done and a second press of Calibrate both bring back Takes", () => {
    const calibrating = run(fresh, press("takes"), press("calibrate"))
    expect(calibrating.active).toBe("calibrate")
    expect(calibrating.calibrationOpen).toBe(true)
    expect(seen(nextPanes(calibrating, close("calibrate")))).toEqual({ active: "takes", codeOpen: false, side: "closed", checksOpen: false, calibrationOpen: false })
    expect(seen(nextPanes(calibrating, press("calibrate")))).toEqual({ active: "takes", codeOpen: false, side: "closed", checksOpen: false, calibrationOpen: false })
  })
  test("Checks over Calibrate: each close goes back one step", () => {
    const stacked = run(fresh, press("code"), press("calibrate"), press("checks"))
    const checksClosed = nextPanes(stacked, close("checks"))
    expect(seen(checksClosed)).toEqual({ active: "calibrate", codeOpen: true, side: "closed", checksOpen: false, calibrationOpen: true })
    expect(seen(nextPanes(checksClosed, close("calibrate")))).toEqual({ active: "code", codeOpen: true, side: "closed", checksOpen: false, calibrationOpen: false })
  })
  test("with nothing else open, Preview comes to the front", () => {
    expect(seen(run(fresh, press("code"), press("code")))).toEqual({ active: "preview", codeOpen: false, side: "closed", checksOpen: false, calibrationOpen: false })
    expect(seen(run(fresh, press("checks"), close("checks")))).toEqual({ active: "preview", codeOpen: false, side: "closed", checksOpen: false, calibrationOpen: false })
  })
  test("a tool that was closed later is skipped", () => {
    // Knobs came to the front after Takes, but its panel was closed while Code was in front.
    const panes = run(fresh, press("takes"), press("knobs"), press("code"), close("knobs"), close("code"))
    expect(seen(panes)).toEqual({ active: "takes", codeOpen: false, side: "closed", checksOpen: false, calibrationOpen: false })
  })
})

describe("only the pane in front closes", () => {
  test("pressing an open pane that another tool covers brings it to the front", () => {
    const covered = run(fresh, press("code"), press("preview"))
    expect(seen(covered)).toEqual({ active: "preview", codeOpen: true, side: "closed", checksOpen: false, calibrationOpen: false })
    expect(seen(nextPanes(covered, press("code")))).toEqual({ active: "code", codeOpen: true, side: "closed", checksOpen: false, calibrationOpen: false })
  })
  test("Calibrate too: covered by Code, a press brings it back instead of closing it", () => {
    const covered = run(fresh, press("calibrate"), press("code"))
    expect(seen(nextPanes(covered, press("calibrate")))).toEqual({ active: "calibrate", codeOpen: true, side: "closed", checksOpen: false, calibrationOpen: true })
  })
  test("closing a pane that is open but not in front leaves the front alone", () => {
    // On a desk the Knobs panel stays beside the canvas while Code is in front.
    const beside = run(fresh, press("knobs"), press("code"))
    expect(seen(nextPanes(beside, close("knobs")))).toEqual({ active: "code", codeOpen: true, side: "closed", checksOpen: false, calibrationOpen: false })
  })
  test("closing a pane that is not open changes nothing", () => {
    const panes = run(fresh, press("takes"))
    for (const pane of ["code", "knobs", "checks", "calibrate", "record"] as const) expect(nextPanes(panes, close(pane))).toEqual(panes)
  })
})

describe("Takes is a view of the canvas, like Preview", () => {
  test("Takes shows the take's record when there is a take, and a second press changes nothing", () => {
    const shown = run(fresh, press("takes", true))
    expect(seen(shown)).toEqual({ active: "takes", codeOpen: false, side: "record", checksOpen: false, calibrationOpen: false })
    expect(seen(nextPanes(shown, press("takes", true)))).toEqual(seen(shown))
  })
  test("closing the record leaves Takes in front", () => {
    const closed = run(fresh, press("code"), press("takes", true), close("record"))
    expect(seen(closed)).toEqual({ active: "takes", codeOpen: true, side: "closed", checksOpen: false, calibrationOpen: false })
  })
  test("Takes takes the side slot from Knobs", () => {
    expect(run(fresh, press("knobs"), press("takes", true)).side).toBe("record")
    expect(run(fresh, press("knobs"), press("takes", false)).side).toBe("closed")
  })
})

describe("panes restored without a history", () => {
  test("open panes count as earlier than the tool in front", () => {
    const restored = restorePanes({ active: "code", codeOpen: true, side: "knobs", checksOpen: false, calibrationOpen: false })
    expect(nextPanes(restored, close("code")).active).toBe("knobs")
  })
  test("an open record counts as Takes", () => {
    const restored = restorePanes({ active: "checks", codeOpen: false, side: "record", checksOpen: true, calibrationOpen: false })
    expect(nextPanes(restored, close("checks")).active).toBe("takes")
  })
  test("a tool brought to the front outside the rule still counts", () => {
    // The app selects a take and puts Takes in front itself, without a press.
    const outside: Panes = { ...run(fresh, press("code")), active: "takes", side: "record" }
    expect(run(outside, press("checks"), close("checks")).active).toBe("takes")
  })
})
