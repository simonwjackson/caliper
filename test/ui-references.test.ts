import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ReferenceList } from "../src/client/ui/canvas/ReferenceList"
import { CROP_PAD, CROP_ROOM, VISIBLE_REFERENCES, cropView, insertReference, matchReferences, noteSegments, typedName } from "../src/client/ui/references"
import { createScenario } from "../src/client/ui/fixtures/scenario"
import { originalView, referencesView, typeaheadView, withPromptView } from "../src/client/ui/fixtures/views"
import type { ChromeView, ReferenceOption } from "../src/client/ui/contract"

const ready = (view: ChromeView) => {
  if (view.markup._tag !== "Ready") throw new Error("The fixture's markup is not ready")
  return view.markup
}
const option = (name: string): ReferenceOption => ({ id: `m-${name}`, name, note: "", label: "", crop: null })

describe("typedName: the mark name typed at the caret", () => {
  test("a take number, or 0, and up to three letters at the start of a word", () => {
    expect(typedName("like 0", 6)).toEqual({ start: 5, end: 6, query: "0" })
    expect(typedName("use 7a", 6)).toEqual({ start: 4, end: 6, query: "7a" })
    expect(typedName("12", 2)).toEqual({ start: 0, end: 2, query: "12" })
    expect(typedName("(0", 2)).toEqual({ start: 1, end: 2, query: "0" })
  })
  test("not inside a word, after a point, past three letters, or away from the caret", () => {
    expect(typedName("v2", 2)).toBeNull()
    expect(typedName("0.5", 3)).toBeNull()
    expect(typedName("7ABCD", 5)).toBeNull()
    expect(typedName("like 0 ", 7)).toBeNull()
    expect(typedName("like", 4)).toBeNull()
    expect(typedName("", 0)).toBeNull()
  })
  test("letters after the caret belong to the name; digits after it do not make one", () => {
    expect(typedName("use 7A here", 5)).toEqual({ start: 4, end: 6, query: "7A" })
    expect(typedName("use 7A5", 5)).toBeNull()
  })
})

describe("matchReferences: names that start with what is typed", () => {
  const options = ["0A", "0B", "5A", "10C", "1A"].map(option)
  test("in draft order, letters in either case", () => {
    expect(matchReferences(options, "0").map(item => item.name)).toEqual(["0A", "0B"])
    expect(matchReferences(options, "0b").map(item => item.name)).toEqual(["0B"])
    expect(matchReferences(options, "1").map(item => item.name)).toEqual(["10C", "1A"])
    expect(matchReferences(options, "6")).toEqual([])
  })
})

describe("insertReference: the name replaces what was typed, and nothing else changes", () => {
  test("at the end: the name and a space", () => {
    const text = "Thin the border, like 0"
    expect(insertReference(text, { start: 22, end: 23, query: "0" }, "0A")).toEqual({ text: "Thin the border, like 0A ", caret: 25 })
  })
  test("mid-note: an existing space is kept and the caret goes past it", () => {
    expect(insertReference("use 7 here", { start: 4, end: 5, query: "7" }, "7A")).toEqual({ text: "use 7A here", caret: 7 })
  })
  test("before punctuation: no space", () => {
    expect(insertReference("like 0, please", { start: 5, end: 6, query: "0" }, "0B")).toEqual({ text: "like 0B, please", caret: 7 })
  })
})

describe("noteSegments: names set apart, the note unchanged", () => {
  test("only the names given, as whole words", () => {
    const note = "Restore 0A here, with the spacing of 3A, not v3A or 9Z"
    const segments = noteSegments(note, ["0A", "3A"])
    expect(segments.map(segment => segment.text).join("")).toBe(note)
    expect(segments.filter(segment => segment._tag === "Name").map(segment => segment.text)).toEqual(["0A", "3A"])
  })
  test("no names, or no note", () => {
    expect(noteSegments("Love this", [])).toEqual([{ _tag: "Text", text: "Love this" }])
    expect(noteSegments("", ["0A"])).toEqual([])
  })
})

describe("cropView: the part of the page a crop shows", () => {
  const page = { width: 640, height: 480 }, box = { width: 64, height: 48 }
  test("a point: a fifth of the page's width round it, the box's shape, the point in the box", () => {
    const view = cropView(page, { x: 320, y: 240, width: 0, height: 0 }, box)
    expect(view.scale).toBeCloseTo(box.width / (page.width * CROP_ROOM))
    expect(view.mark.x).toBeCloseTo(32)
    expect(view.mark.y).toBeCloseTo(24)
  })
  test("near an edge the window stays in the page, and the mark stays in the box", () => {
    const view = cropView(page, { x: 4, y: 470, width: 0, height: 0 }, box)
    expect(view.x).toBe(0)
    expect(view.y).toBeCloseTo(page.height - 48 / view.scale)
    expect(view.mark.x).toBeGreaterThanOrEqual(0)
    expect(view.mark.y).toBeLessThanOrEqual(box.height)
  })
  test("a region is held with room round it", () => {
    const rect = { x: 141, y: 77, width: 166, height: 125 }
    const view = cropView(page, rect, box)
    // The window is the larger of the region's width and its height in the box's shape, and half as much again.
    expect(view.scale).toBeCloseTo(box.width / (Math.max(rect.width, rect.height * 4 / 3) * (1 + CROP_PAD)))
    expect(view.mark.x).toBeGreaterThanOrEqual(0)
    expect(view.mark.x + view.mark.width).toBeLessThanOrEqual(box.width + 0.01)
    expect(view.mark.y + view.mark.height).toBeLessThanOrEqual(box.height + 0.01)
  })
  test("a region larger than the page shows the whole page, centred", () => {
    const view = cropView(page, { x: 0, y: 0, width: 640, height: 480 }, box)
    expect(view.scale).toBeCloseTo(0.1)
    expect(view.x).toBeCloseTo(0)
    expect(view.y).toBeCloseTo(0)
  })
})

describe("ReferenceList: only the options drawn load a crop page", () => {
  test("at most VISIBLE_REFERENCES options and pages; the rest are counted", () => {
    const crop = { src: "about:blank", viewport: { width: 640, height: 480 }, rect: { x: 10, y: 10, width: 0, height: 0 } }
    const options = Array.from({ length: VISIBLE_REFERENCES + 3 }, (_, index) => ({ ...option(`1${String.fromCharCode(65 + index)}`), crop }))
    const html = renderToStaticMarkup(createElement(ReferenceList, { id: "list", options, active: 0, onPick: () => undefined, onActive: () => undefined }))
    expect(html.match(/<iframe/g)?.length).toBe(VISIBLE_REFERENCES)
    expect(html.match(/data-cal="mark-reference"/g)?.length).toBe(VISIBLE_REFERENCES)
    expect(html).toContain("3 more match. Type more of the name.")
  })
})

describe("the gallery's phase 6 fixtures follow the shared Send policy", () => {
  test("references: the real files and take 3 are pointed to and make no take", () => {
    const markup = ready(referencesView())
    expect(markup.groups.map(group => [group.source.take, group.outcome._tag])).toEqual([["0", "PointedTo"], ["6", "NewTake"], ["5", "NewTake"], ["3", "PointedTo"], ["2", "NewTake"]])
    expect(markup.groups[0]?.label).toBe("Original · the real files")
    expect(markup.groups[0]?.outcome.label).toBe("Pointed to by 6B and 5A; makes no take.")
    expect(markup.groups.find(group => group.source.take === "3")?.outcome.label).toBe("Pointed to by 5A; makes no take.")
    expect(markup.groups.flatMap(group => group.marks).find(mark => mark.name === "5A")?.references).toEqual(["0A", "3A"])
    expect(markup.send._tag === "Idle" && markup.send.label).toBe("Send · 3 new takes")
  })
  test("typeahead: the note at 6B can point to every mark off take 6, with a crop unless it is lost", () => {
    const markup = ready(typeaheadView())
    if (markup.editor._tag !== "Open") throw new Error("The editor is closed")
    expect(markup.editor.name).toBe("6B")
    expect(markup.editor.references.map(item => item.name)).toEqual(["0A", "0B", "5A", "3A", "2A"])
    expect(markup.editor.references.find(item => item.name === "3A")?.crop).toBeNull()
    expect(markup.editor.references.find(item => item.name === "2A")?.crop?.viewport.width).toBe(1920)
    expect(matchReferences(markup.editor.references, "0").length).toBeLessThanOrEqual(VISIBLE_REFERENCES)
  })
  test("original: two unnamed marks on the real files make one take", () => {
    const markup = ready(originalView())
    expect(markup.send._tag === "Idle" && markup.send.label).toBe("Send · 1 new take")
    expect(markup.groups.map(group => group.marks.map(mark => mark.name))).toEqual([["0A", "0B"]])
  })
  test("withPrompt: the marks go with a typed prompt, not an empty one, and leave the draft at New take", () => {
    const view = withPromptView()
    expect(view.composer.marks).toEqual({ _tag: "WithPrompt", names: ["0A", "0B"], label: "0A and 0B go with this prompt." })
    expect(ready(view).groups[0]?.outcome._tag).toBe("WithPrompt")
    const scenario = createScenario(view)
    scenario.actions.onPrompt("")
    expect(scenario.getView().composer.marks._tag).toBe("None")
    expect(ready(scenario.getView()).groups[0]?.outcome).toEqual({ _tag: "NewTake", label: "Send makes a new take from the real files." })
    scenario.actions.onPrompt("Tidy it")
    expect(scenario.getView().composer.marks._tag).toBe("WithPrompt")
    scenario.actions.onStart()
    expect(ready(scenario.getView()).groups).toEqual([])
    expect(scenario.getView().composer.marks._tag).toBe("None")
  })
  test("a mark on the real files that a note points to stays for Send, even with a prompt", () => {
    const scenario = createScenario(referencesView())
    scenario.actions.onPrompt("Tidy it")
    expect(scenario.getView().composer.marks._tag).toBe("None")
    expect(ready(scenario.getView()).groups[0]?.outcome._tag).toBe("PointedTo")
  })
  test("a note on the real files cannot point to another mark on the real files", () => {
    const scenario = createScenario(withPromptView())
    scenario.actions.onMarkEdit("m-0b")
    scenario.actions.onMarkNote("m-0b", "Like 0A")
    expect(ready(scenario.getView()).groups[0]?.marks.find(mark => mark.name === "0B")?.references).toEqual([])
    expect(scenario.getView().composer.marks).toEqual({ _tag: "WithPrompt", names: ["0A", "0B"], label: "0A and 0B go with this prompt." })
  })
})
