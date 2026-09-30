import { expect, test } from "bun:test"
import { acceptFlag, chainOf, lineageLabel, planChains } from "../src/takes/chains.js"
import type { AcceptRecord, ChainTake } from "../src/takes/chains.js"

const id = (take: string, created: number) => ({ take, created })
const part = "src/Card.part.tsx"
/** A take made from a prompt. */
const root = (take: string, created: number, files: string[] = ["src/card.css"]): ChainTake => ({ ...id(take, created), part, state: "default", files })
/** A take made from marks on the last take of `lineage`. */
const child = (take: string, created: number, lineage: ChainTake[], files: string[] = ["src/card.css"]): ChainTake => ({
  ...root(take, created, files), chain: id(lineage[0]!.take, lineage[0]!.created), lineage: lineage.map(item => id(item.take, item.created)),
})

const one = root("1", 100), two = root("2", 200), three = root("3", 300)
const four = child("4", 400, [one]), five = child("5", 500, [two]), six = child("6", 600, [one, four])

test("a take with no parent and no children is a chain of one, with no pair", () => {
  const [chain] = planChains([three], null)
  expect(chain).toMatchObject({ id: "3@300", shown: id("3", 300), parent: null, discarded: 0, steps: [{ take: "3", created: 300, present: true }] })
})

test("each chain shows its newest take next to its parent, in the order the chains began", () => {
  const chains = planChains([six, three, five, two, four, one], null)
  expect(chains.map(chain => chain.id)).toEqual(["1@100", "2@200", "3@300"])
  expect(chains[0]).toMatchObject({ shown: id("6", 600), parent: id("4", 400), discarded: 0 })
  expect(chains[0]?.steps.map(step => step.take)).toEqual(["1", "4", "6"])
  expect(chains[1]).toMatchObject({ shown: id("5", 500), parent: id("2", 200) })
})

test("a discarded middle take: the pair spans the gap and the history keeps it, marked gone", () => {
  const [chain] = planChains([one, six], null)
  expect(chain).toMatchObject({ shown: id("6", 600), parent: id("1", 100), discarded: 1 })
  expect(chain?.steps).toEqual([{ take: "1", created: 100, present: true }, { take: "4", created: 400, present: false }, { take: "6", created: 600, present: true }])
  expect(lineageLabel(chain!)).toBe("6 ← from 1 (1 discarded)")
})

test("a discarded root: children keep their chain, and the pair has no parent", () => {
  const [chain] = planChains([four], null)
  expect(chain).toMatchObject({ id: "1@100", shown: id("4", 400), parent: null, discarded: 1 })
  expect(lineageLabel(chain!)).toBe("4 (1 discarded before it)")
})

test("selecting an older take opens it in the pair; the chain's newest take stays its head", () => {
  const [chain] = planChains([one, four, six], id("4", 400))
  expect(chain).toMatchObject({ head: id("6", 600), shown: id("4", 400), parent: id("1", 100) })
  expect(chain?.steps.find(step => step.take === "4")).toMatchObject({ present: true })
})

test("two passes on one take branch the chain; every branch stays in the history", () => {
  const seven = child("7", 700, [one])
  const [chain] = planChains([one, four, seven], null)
  expect(chain).toMatchObject({ head: id("7", 700), shown: id("7", 700), parent: id("1", 100) })
  expect(chain?.steps.map(step => step.take)).toEqual(["1", "4", "7"])
})

test("a reused take number is a different take: identity is number and creation time", () => {
  const again = root("4", 900)
  const chains = planChains([one, again, six], null)
  expect(chains.map(chain => chain.id)).toEqual(["1@100", "4@900"])
  expect(chains[0]).toMatchObject({ parent: id("1", 100), discarded: 1 })
})

test("chainOf names the chain's first take, or the take itself", () => {
  expect(chainOf(six)).toEqual(id("1", 100))
  expect(chainOf(one)).toEqual(id("1", 100))
})

test("labels", () => {
  const [single] = planChains([three], null), [pair] = planChains([one, four], null)
  expect(lineageLabel(single!)).toBe("3")
  expect(lineageLabel(pair!)).toBe("4 ← from 1")
})

// Planner choice 15, answered C: same part, or files that overlap.
const accepted = (take: string, at: number, files: string[], acceptedPart = part): AcceptRecord => ({ take, created: at - 50, part: acceptedPart, state: "default", files, at })

test("a take of the same part made before an accept is flagged", () => {
  expect(acceptFlag(three, [accepted("8", 800, ["src/other.css"])])).toEqual({ _tag: "Before", take: "8", reason: "Part" })
})

test("a take of another part is flagged when its files overlap the accepted files", () => {
  const other = { ...root("3", 300, ["src/tokens.css"]), part: "src/Other.part.tsx" }
  expect(acceptFlag(other, [accepted("8", 800, ["src/tokens.css", "src/card.css"])])).toEqual({ _tag: "Before", take: "8", reason: "Files", files: ["src/tokens.css"] })
  expect(acceptFlag(other, [accepted("8", 800, ["src/card.css"])])).toEqual({ _tag: "Current" })
})

test("a take made after the accept is current, and the newest matching accept names the flag", () => {
  expect(acceptFlag(root("9", 900), [accepted("8", 800, ["src/card.css"])])).toEqual({ _tag: "Current" })
  const flag = acceptFlag(one, [accepted("8", 800, ["src/card.css"]), accepted("2", 850, ["src/card.css"]), accepted("7", 820, ["src/card.css"])])
  expect(flag).toMatchObject({ _tag: "Before", take: "2" })
})

test("an accept of the same part that also shares files reports both", () => {
  expect(acceptFlag(one, [accepted("8", 800, ["src/card.css"])])).toEqual({ _tag: "Before", take: "8", reason: "PartAndFiles", files: ["src/card.css"] })
})

test("wording: history count, accept note and flag", async () => {
  const { acceptNote, flagWords, historyLabel } = await import("../src/takes/chains.js")
  const [chain] = planChains([one, four, six], null)
  expect(historyLabel(3)).toBe("3 in chain")
  expect(acceptNote(chain!, id("6", 600))).toBe("Accept also removes takes 1 and 4 of this chain.")
  expect(acceptNote(planChains([three], null)[0]!, id("3", 300))).toBe("")
  expect(flagWords({ _tag: "Current" })).toBeNull()
  expect(flagWords({ _tag: "Before", take: "8", reason: "Files", files: ["src/tokens.css"] })).toEqual({ label: "made before take 8 was accepted", detail: "Take 8 changed src/tokens.css after this take was made. Accepting this take can undo that." })
})
