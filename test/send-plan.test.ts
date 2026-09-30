import { expect, test } from "bun:test"
import { ORIGINAL, planSend, referencesIn } from "../src/takes/send-plan.js"
import type { SendMark, SendTake } from "../src/takes/send-plan.js"

const first = { take: "1", created: 100 }
const second = { take: "2", created: 200 }
const takes: readonly SendTake[] = [
  { ...first, kind: "Experiment", run: { _tag: "Idle" } },
  { ...second, kind: "Experiment", run: { _tag: "Idle" } },
  { take: "3", created: 300, kind: "Experiment", run: { _tag: "Idle" } },
]
const marks: readonly SendMark[] = [
  { id: "1A", name: "1A", note: "", source: first, location: { _tag: "Located" } },
  { id: "2A", name: "2A", note: "", source: second, location: { _tag: "Located" } },
  { id: "1B", name: "1B", note: "", source: first, location: { _tag: "Located" } },
]

test("one Send makes one new take per marked parent, not per mark", () => {
  const result = planSend(marks, takes)
  expect(result._tag).toBe("Ready")
  expect(result.markCount).toBe(3)
  expect(result.takeCount).toBe(2)
  expect(result.label).toBe("Send · 2 new takes")
  expect(result.groups.map(group => [group.source, group.marks])).toEqual([
    [first, ["1A", "1B"]], [second, ["2A"]],
  ])
})

test("a running parent blocks the whole pass even when another parent is ready", () => {
  const pass: readonly SendMark[] = [...marks, { id: "3A", name: "3A", note: "", source: { take: "3", created: 300 }, location: { _tag: "Located" } }]
  const result = planSend(pass, takes.map(take => take.take === "2" ? { ...take, run: { _tag: "Running" } } : take))
  expect(result._tag).toBe("Blocked")
  expect(result.groups[0]?.reasons).toEqual([])
  expect(result.groups[2]?.reasons).toEqual([])
  if (result._tag === "Blocked") expect(result.reasons).toContain("Take 2 is still running. Stop its agent or wait.")
  expect(result.takeCount).toBe(3)
})

test("a lost or unresolved mark blocks all takes and remains in its group", () => {
  for (const _tag of ["Lost", "Unresolved"] as const) {
    const result = planSend([{ ...marks[0]!, location: { _tag, reason: "Element not found. Re-place or remove the mark." } }, marks[1]!], takes)
    expect(result._tag).toBe("Blocked")
    expect(result.markCount).toBe(2)
    expect(result.groups[0]?.marks).toEqual(["1A"])
    if (result._tag === "Blocked") expect(result.reasons[0]).toContain("Re-place or remove")
  }
})

test("reused take numbers never redirect marks to the replacement take", () => {
  const result = planSend(marks, takes.map(take => take.take === "1" ? { ...take, created: 999 } : take))
  expect(result._tag).toBe("Blocked")
  expect(result.groups[0]?.source).toEqual(first)
  if (result._tag === "Blocked") expect(result.reasons[0]).toContain("creation identity")
})

test("marks on removed or alternate parents are retained and block Send", () => {
  expect(planSend(marks, [])._tag).toBe("Blocked")
  const result = planSend(marks, takes.map(take => ({ ...take, kind: "Alternate" })))
  expect(result._tag).toBe("Blocked")
  expect(result.groups.flatMap(group => group.marks)).toEqual(["1A", "1B", "2A"])
})

test("empty drafts do not authorize Send and singular counts use one take", () => {
  expect(planSend([], takes)).toMatchObject({ _tag: "Empty", groups: [], markCount: 0, takeCount: 0 })
  expect(planSend([marks[0]!], takes).label).toBe("Send · 1 new take")
})

test("a failed but stopped parent is markable, and planning never mutates inputs", () => {
  const before = structuredClone({ marks, takes })
  expect(planSend(marks, takes.map(take => ({ ...take, run: { _tag: "Failed", reason: "Model unavailable" } })))._tag).toBe("Ready")
  expect({ marks, takes }).toEqual(before)
  const result = planSend(marks, takes)
  expect(result.groups[0]?.source).not.toBe(first)
})

test("reasons name a mark by its take and letter, never by its opaque id", () => {
  const opaque = { id: "48c523ff-f955-4536-8a8a-1c74b597f744", name: "2A", note: "", source: second, location: { _tag: "Lost" as const, reason: "Element not found." } }
  const lost = planSend([opaque], takes)
  expect(lost._tag).toBe("Blocked")
  if (lost._tag === "Blocked") expect(lost.reasons).toEqual(["2A: Element not found."])
  const twice = planSend([{ ...opaque, location: { _tag: "Located" } }, { ...opaque, location: { _tag: "Located" } }], takes)
  if (twice._tag === "Blocked") expect(twice.reasons.join(" ")).not.toContain(opaque.id)
  expect(twice._tag).toBe("Blocked")
})

test("duplicate mark ids block rather than launching ambiguous jobs", () => {
  expect(planSend([marks[0]!, marks[0]!], takes)._tag).toBe("Blocked")
})

// Phase 6: references between takes (decisions 6 and 7) and marks on the original (decision 8).
const located = { _tag: "Located" } as const
const mark = (name: string, note = "", source = name.startsWith("0") ? ORIGINAL : name.startsWith("1") ? first : second): SendMark => ({ id: `id-${name}`, name, note, source, location: located })

test("a note names marks on other takes by take and letter; its own take and unknown names are not references", () => {
  const names = ["1A", "2A", "2B", "0A"]
  expect(referencesIn("use 2A here, and 0A. Not 2C, not x2Ay, and 1A is mine", "1", names)).toEqual(["2A", "0A"])
  expect(referencesIn("2a lower case is not a name", "1", names)).toEqual([])
  expect(referencesIn("2A and 2A again", "1", names)).toEqual(["2A"])
})

test("a take whose marks are all pointed to makes no new take; its marks go with the pointing take", () => {
  const result = planSend([mark("1A", "use 2A here"), mark("2A", "nice spacing")], takes)
  expect(result._tag).toBe("Ready")
  expect(result.takeCount).toBe(1)
  expect(result.label).toBe("Send · 1 new take")
  expect(result.groups.map(group => [group.source.take, group.outcome._tag, group.pointsTo])).toEqual([["1", "NewTake", ["id-2A"]], ["2", "PointedTo", []]])
})

test("one mark nobody points to is enough for a take to get a new take", () => {
  const result = planSend([mark("1A", "use 2A here"), mark("2A"), mark("2B", "too loud")], takes)
  expect(result.takeCount).toBe(2)
  expect(result.groups.map(group => group.outcome._tag)).toEqual(["NewTake", "NewTake"])
})

test("marks on the original: pointed to they never make a take; unpointed they make one take from the real files", () => {
  const pointed = planSend([mark("1A", "restore 0A"), mark("0A")], takes)
  expect(pointed.groups.map(group => [group.source.take, group.outcome._tag])).toEqual([["1", "NewTake"], ["0", "PointedTo"]])
  expect(pointed.takeCount).toBe(1)
  const alone = planSend([mark("0A", "too big"), mark("0B")], [])
  expect(alone).toMatchObject({ _tag: "Ready", takeCount: 1 })
  expect(alone.groups[0]).toMatchObject({ source: ORIGINAL, outcome: { _tag: "NewTake" }, reasons: [] })
})

test("marks that only point at each other make nothing, and Send says why", () => {
  const result = planSend([mark("1A", "like 2A"), mark("2A", "like 1A")], takes)
  expect(result._tag).toBe("Blocked")
  expect(result.takeCount).toBe(0)
  if (result._tag === "Blocked") expect(result.reasons).toEqual(["Every mark is pointed to by another note, so Send makes no take. Add a mark that no note points to."])
})

test("a lost mark that a note points to still blocks the pass", () => {
  const result = planSend([mark("1A", "use 2A"), { ...mark("2A"), location: { _tag: "Lost", reason: "Element not found." } }], takes)
  expect(result._tag).toBe("Blocked")
  if (result._tag === "Blocked") expect(result.reasons).toEqual(["2A: Element not found."])
})
