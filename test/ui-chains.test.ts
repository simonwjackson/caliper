import { describe, expect, test } from "bun:test"
import { createScenario } from "../src/client/ui/fixtures/scenario"
import { FIXTURES, chainHistoryView, chainsAcceptedView, takesView } from "../src/client/ui/fixtures/views"
import { CAL } from "../src/client/ui/hooks"
import { applicableHooks } from "../scripts/ui/applicable"
import type { ChainView, ChromeView } from "../src/client/ui/contract"

const chainsOf = (view: ChromeView): readonly ChainView[] => view.canvas._tag === "Frames" ? view.canvas.chains : []
const framesOf = (view: ChromeView) => view.canvas._tag === "Frames" ? view.canvas.frames : []

describe("the gallery's chains follow the shared chain policy", () => {
  test("the mockup: 6 from 1 across a discarded 4, 5 from 2, and 3 alone and flagged", () => {
    const view = takesView()
    expect(chainsOf(view).map(chain => chain.label)).toEqual(["6 ← from 1 (1 discarded)", "5 ← from 2", "3"])
    expect(chainsOf(view).map(chain => chain.history)).toEqual([
      { _tag: "Folded", label: "3 in chain" }, { _tag: "Folded", label: "2 in chain" }, { _tag: "None" },
    ])
    expect(chainsOf(view).map(chain => chain.flag._tag)).toEqual(["Current", "Current", "Before"])
    expect(framesOf(view).map(frame => frame.take ?? "real")).toEqual(["real", "1", "6", "2", "5", "3"])
    expect(view.focusedTake?.lineage).toBe("6 ← from 1 (1 discarded)")
  })
  test("every take frame of every fixture sits in exactly one chain, and every chain names frames that exist", () => {
    for (const [name, make] of Object.entries(FIXTURES)) {
      const view = make()
      if (view.canvas._tag !== "Frames" || view.canvas.mode !== "Takes") continue
      const keys = view.canvas.frames.map(frame => frame.key)
      const named = chainsOf(view).flatMap(chain => chain.parent ? [chain.parent, chain.shown] : [chain.shown])
      expect(named.every(key => keys.includes(key)), name).toBe(true)
      expect(new Set(named).size, name).toBe(named.length)
      expect(view.canvas.frames.filter(frame => frame.take).map(frame => frame.key).sort(), name).toEqual([...named].sort())
    }
  })
  test("a branch stays in the history; a discarded root of a gap stays struck", () => {
    const [first] = chainsOf(chainHistoryView())
    expect(first?.history._tag).toBe("Open")
    if (first?.history._tag !== "Open") return
    expect(first.history.steps.map(step => `${step._tag}:${step.take}`)).toEqual(["Present:1", "Discarded:4", "Present:6", "Present:7"])
    const gap = chainsOf(chainsAcceptedView()).find(chain => chain.parent)
    expect(gap?.label).toBe("7 ← from 3 (1 discarded)")
    expect(gap?.solo).toBe("Parent")
  })
  test("after an accept of this part every chain is flagged, and the record says why", () => {
    const view = chainsAcceptedView()
    expect(chainsOf(view).every(chain => chain.flag._tag === "Before" && chain.flag.label === "made before take 8 was accepted")).toBe(true)
    expect(view.record._tag === "Open" && view.record.take.flag._tag === "Before" && view.record.take.flag.detail).toContain("src/pages/PicoGameDetail.css")
  })
})

describe("the gallery's scenario changes the chains as core would", () => {
  test("onChainHistory unfolds a chain with its steps and folds it again", () => {
    const scenario = createScenario(takesView())
    const id = chainsOf(scenario.getView())[0]!.id
    scenario.actions.onChainHistory(id, true)
    const open = chainsOf(scenario.getView())[0]!.history
    expect(open._tag === "Open" && open.steps.map(step => step.label)).toEqual(["Take 1", "Take 4, discarded", "Take 6"])
    scenario.actions.onChainHistory(id, false)
    expect(chainsOf(scenario.getView())[0]!.history).toEqual({ _tag: "Folded", label: "3 in chain" })
    expect(scenario.calls.filter(call => call.name === "onChainHistory").map(call => call.args)).toEqual([[id, true], [id, false]])
  })
  test("onChainSolo keeps the side per chain; a chain with no parent stays on its take", () => {
    const scenario = createScenario(takesView())
    const [first, , alone] = chainsOf(scenario.getView())
    scenario.actions.onChainSolo(first!.id, "Parent")
    scenario.actions.onChainSolo(alone!.id, "Parent")
    expect(chainsOf(scenario.getView()).map(chain => chain.solo)).toEqual(["Parent", "Shown", "Shown"])
    scenario.actions.onChainHistory(first!.id, true)
    expect(chainsOf(scenario.getView())[0]!.solo).toBe("Parent")
  })
  test("picking an older take opens it in the pair beside its own ancestor and focuses it (choice 16)", () => {
    const scenario = createScenario(chainHistoryView())
    scenario.actions.onTake("7")
    const view = scenario.getView()
    expect(chainsOf(view)[0]!.label).toBe("7 ← from 1")
    expect(framesOf(view).filter(frame => frame.selected).map(frame => frame.take)).toEqual(["7"])
    expect(view.focusedTake?.id).toBe("7")
    expect(view.focusedTake?.lineage).toBe("7 ← from 1")
    expect(view.composer.follow?.label).toBe("Send to take 7")
    const history = chainsOf(view)[0]!.history
    expect(history._tag === "Open" && history.steps.filter(step => step._tag === "Present" && step.selected).map(step => step.take)).toEqual(["7"])
  })
})

describe("the hook union over the gallery covers the chain hooks", () => {
  test("chain, history, step, flag and, where a pair does not fit, the swap", () => {
    const found = new Set<string>()
    for (const make of Object.values(FIXTURES)) {
      for (const pairs of ["fit", "solo"]) for (const hook of applicableHooks(make(), { bar: true, code: "below", pairs })) found.add(hook)
    }
    for (const hook of [CAL.chain, CAL.chainHistory, CAL.chainStep, CAL.chainFlag, CAL.chainSolo]) expect(found.has(hook), hook).toBe(true)
    expect(applicableHooks(takesView(), { bar: true, code: "closed", pairs: "fit" })).not.toContain(CAL.chainSolo)
  })
})
