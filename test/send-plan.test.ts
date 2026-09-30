import { expect, test } from "bun:test"
import { planSend } from "../src/takes/send-plan.js"
import type { SendMark, SendTake } from "../src/takes/send-plan.js"

const first = { take: "1", created: 100 }
const second = { take: "2", created: 200 }
const takes: readonly SendTake[] = [
  { ...first, kind: "Experiment", run: { _tag: "Idle" } },
  { ...second, kind: "Experiment", run: { _tag: "Idle" } },
  { take: "3", created: 300, kind: "Experiment", run: { _tag: "Idle" } },
]
const marks: readonly SendMark[] = [
  { id: "1A", name: "1A", source: first, location: { _tag: "Located" } },
  { id: "2A", name: "2A", source: second, location: { _tag: "Located" } },
  { id: "1B", name: "1B", source: first, location: { _tag: "Located" } },
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
  const pass: readonly SendMark[] = [...marks, { id: "3A", name: "3A", source: { take: "3", created: 300 }, location: { _tag: "Located" } }]
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
  const opaque = { id: "48c523ff-f955-4536-8a8a-1c74b597f744", name: "2A", source: second, location: { _tag: "Lost" as const, reason: "Element not found." } }
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
