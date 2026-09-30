// @ts-check
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createTakeStore } from "../src/takes/store.js"
import { createMarkStore, StaleDraft } from "../src/takes/marks.js"
import { letterAt, nextLetter } from "../src/takes/marks-contract.js"
import { childRecord } from "../src/agent/markup.js"
import { markupMessage } from "../src/agent/markup-message.js"

/** @param {Record<string, string>} files @param {(root: string) => void} run */
function inFolder(files, run) {
  const root = mkdtempSync(join(tmpdir(), "caliper-marks-"))
  try {
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), content)
    }
    run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const files = { "src/Chip.part.tsx": "export default () => null\n", "src/chip.css": ".chip { color: blue }\n", "src/Chip.tsx": "export const Chip = () => null\n" }
/** @type {import("../src/takes/marks-contract.js").MarkAnchor} */
const anchor = {
  kind: "Point", rect: { x: 40, y: 12, width: 0, height: 0 }, afterInput: false, elements: [],
  element: { selector: "#caliper-host > button:nth-of-type(1)", tag: "button", classes: ["chip"], text: "Chip default", box: { x: 30, y: 4, width: 80, height: 24 } },
}
const PNG = { name: "shot.png", mimeType: /** @type {const} */ ("image/png"), bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) }

describe("store.fork", () => {
  test("copies every edited file and no images, and leaves the source unchanged", () => inFolder(files, root => {
    const store = createTakeStore(root)
    const source = store.create({ part: "src/Chip.part.tsx", state: "default", device: "rg353m", prompt: "Warm it up" })
    store.write(source, "src/chip.css", ".chip { color: red }\n")
    store.write(source, "src/deep/New.ts", "export const added = 1\n")
    store.addImages(source, [PNG])
    const before = JSON.stringify([store.record(source), store.files(source)])
    const take = store.fork(source, { part: "src/Chip.part.tsx", state: "default", device: "rg353m", parent: { take: source, created: /** @type {number} */ (store.record(source)?.created) } })
    expect(take).not.toBe(source)
    expect(store.files(take)).toEqual(["src/chip.css", "src/deep/New.ts"])
    expect(store.read(take, "src/chip.css")).toContain("red")
    expect(store.read(take, "src/Chip.tsx")).toBe(files["src/Chip.tsx"])
    expect(store.record(take)?.images).toBeUndefined()
    expect(existsSync(join(root, ".caliper/takes", `${take}.images`))).toBe(false)
    expect(store.record(take)?.parent?.take).toBe(source)
    expect(JSON.stringify([store.record(source), store.files(source)])).toBe(before)
  }))

  test("refuses a missing source without leaving a take behind", () => inFolder(files, root => {
    const store = createTakeStore(root)
    expect(() => store.fork("4", { part: "src/Chip.part.tsx", state: "default", device: "rg353m" })).toThrow("Take 4 does not exist.")
    expect(store.list()).toEqual([])
  }))
})

describe("letters", () => {
  test("run A to Z, then AA, AB, and a removed mark frees its letter", () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(letterAt)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"])
    const alphabet = Array.from({ length: 26 }, (_, index) => letterAt(index))
    expect(nextLetter(alphabet)).toBe("AA")
    expect(nextLetter(["A", "C"])).toBe("B")
    expect(nextLetter([])).toBe("A")
  })
})

describe("the draft of marks", () => {
  test("persists, refuses stale revisions, and gives each take its own letters", () => inFolder(files, root => {
    const marks = createMarkStore(root)
    expect(marks.read()).toEqual({ revision: 0, marks: [] })
    const one = { take: "1", created: 100 }, two = { take: "2", created: 200 }
    const first = marks.add(0, { source: one, preview: { part: "src/Chip.part.tsx", state: "default" }, device: "rg353m", anchor })
    const second = marks.add(first.draft.revision, { source: one, preview: { part: "src/Chip.part.tsx", state: "default" }, device: "rg353m", anchor })
    const other = marks.add(second.draft.revision, { source: two, preview: { part: "src/Chip.part.tsx", state: "default" }, device: "rg353m", anchor })
    expect(other.draft.marks.map(mark => [mark.source.take, mark.letter])).toEqual([["1", "A"], ["1", "B"], ["2", "A"]])
    expect(createMarkStore(root).read()).toEqual(other.draft)
    expect(readFileSync(join(root, ".caliper/.gitignore"), "utf8")).toContain("*")

    let stale
    try { marks.change(first.draft.revision, first.id, { note: "late" }) } catch (error) { stale = error }
    expect(stale).toBeInstanceOf(StaleDraft)
    expect(/** @type {StaleDraft} */ (stale).draft.revision).toBe(3)
    expect(marks.read().marks[0]?.note).toBe("")

    const noted = marks.change(3, first.id, { note: "love this" })
    const removed = marks.remove(noted.revision, first.id)
    expect(removed.marks.map(mark => mark.letter)).toEqual(["B", "A"])
    const again = marks.add(removed.revision, { source: one, preview: { part: "src/Chip.part.tsx", state: "default" }, device: "rg353m", anchor })
    expect(again.draft.marks.at(-1)?.letter).toBe("A")
    const released = marks.release(again.draft.revision, new Set([second.id, again.id]))
    expect(released.marks.map(mark => mark.id)).toEqual([other.id])
    expect(() => marks.remove(released.revision, second.id)).toThrow("no longer in the draft")
  }))

  test("a broken marks.json is reported, not replaced", () => inFolder({ ".caliper/marks.json": "{ nope" }, root => {
    expect(() => createMarkStore(root).read()).toThrow("not JSON")
    expect(readFileSync(join(root, ".caliper/marks.json"), "utf8")).toBe("{ nope")
  }))
})

describe("a take made from marks", () => {
  test("stores its own history, so a discarded ancestor never breaks it", () => {
    const direction = { title: "Cover wide", brief: "Cover art two thirds wide." }
    /** @type {import("../src/takes/marks-contract.js").Mark} */
    const onOne = { id: "m1", source: { take: "1", created: 10 }, preview: { part: "src/Chip.part.tsx", state: "default" }, device: "rg353m", letter: "A", note: "cover is too wide", anchor }
    const root = /** @type {import("../src/takes/store.js").TakeRecord} */ ({ part: "src/Chip.part.tsx", state: "default", device: "rg353m", created: 10, prompt: "Give the cover room", direction })
    const six = { ...childRecord({ take: "1", created: 10 }, root, [onOne]), created: 60 }
    expect(six).toMatchObject({ parent: { take: "1", created: 10 }, chain: { take: "1", created: 10 }, history: { prompt: "Give the cover room", direction, lineage: [{ take: "1", created: 10 }], passes: [] }, marks: [onOne] })
    const onSix = { ...onOne, id: "m6", source: { take: "6", created: 60 }, note: "love this", anchor: { ...anchor, afterInput: true } }
    const nine = childRecord({ take: "6", created: 60 }, six, [onSix])
    expect(nine.chain).toEqual({ take: "1", created: 10 })
    expect(nine.history.lineage).toEqual([{ take: "1", created: 10 }, { take: "6", created: 60 }])
    expect(nine.history.passes).toEqual([{ source: { take: "1", created: 10 }, marks: [onOne] }])
    expect(nine.direction).toBeUndefined()

    const brief = markupMessage({
      take: "9", record: nine, sources: [{ path: "src/Chip.part.tsx", content: "export default () => null" }],
      pictures: [{ preview: { part: "src/Chip.part.tsx", state: "default" }, previewLabel: "Chip · Default", deviceLabel: "RG353M", width: 640, height: 480, drawn: ["A"], missing: [], outside: [] }],
    })
    expect(brief).toContain("You are take 9, a copy of take 6.")
    expect(brief).toContain("Take 9 continues take 6, which continued take 1.")
    expect(brief).toContain("> Give the cover room")
    expect(brief).toContain("## Direction\nCover wide. Cover art two thirds wide.")
    expect(brief).toContain("## Marks on take 1 (an earlier pass)\n1A: cover is too wide")
    expect(brief).toContain("## Marks on take 6 (this pass)\n6A: love this\n   element: button.chip “Chip default” (selector #caliper-host > button:nth-of-type(1))")
    expect(brief).toContain("Placed after input")
    expect(brief).toContain("Picture 1: take 6, Chip · Default, on RG353M at 640 × 480 CSS px, with 6A drawn in.")
    expect(brief).toContain(".caliper/takes/9, a copy of take 6. Nowhere else.")
    expect(brief).toContain('<file path="src/Chip.part.tsx">')
    expect(brief.indexOf("(this pass)")).toBeGreaterThan(brief.indexOf("(an earlier pass)"))
  })

  test("says when the first prompt was never recorded, and names region contents", () => {
    const old = /** @type {import("../src/takes/store.js").TakeRecord} */ ({ part: "src/Chip.part.tsx", state: "default", device: "rg353m", created: 5 })
    /** @type {import("../src/takes/marks-contract.js").Mark} */
    const region = { id: "r", source: { take: "2", created: 5 }, preview: { part: "src/Chip.part.tsx", state: "default" }, device: "rg353m", letter: "B", note: "", anchor: { ...anchor, kind: "Region", rect: { x: 141.4, y: 77, width: 166, height: 125 }, elements: [anchor.element] } }
    const brief = markupMessage({
      take: "3", record: childRecord({ take: "2", created: 5 }, old, [region]), sources: [],
      pictures: [{ preview: { part: "src/Chip.part.tsx", state: "default" }, previewLabel: "Chip · Default", deviceLabel: "RG353M", width: 640, height: 480, drawn: ["B"], missing: ["B"], outside: [] }],
    })
    expect(brief).toContain("Not recorded. Take 2 was made before Caliper kept first prompts.")
    expect(brief).toContain("2B: (no note)")
    expect(brief).toContain("region: 166 × 125 CSS px at 141, 77")
    expect(brief).toContain("contains: button.chip “Chip default”")
    expect(brief).toContain("Not found in this render, drawn where they were placed: 2B.")
    expect(brief).not.toContain("## Direction")
  })
})
