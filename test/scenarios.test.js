// @ts-check
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { discoverParts } from "../src/derive/parts.js"
import { contextsFor, relatedStates, sameState, stateExists, subjectsOf } from "../src/client/scenarios.js"

/** @typedef {import("../src/types").Part} Part */
/** @type {string[]} */
const roots = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

const cart = "src/Cart.molecule.part.tsx"
const shelf = "src/Shelf.organism.part.tsx"
const home = "src/Home.page.part.tsx"
const defaultSource = "export default function Part() { return null }\n"

/** @param {Record<string, string>} files */
function project(files) {
  const root = mkdtempSync(join(tmpdir(), "caliper-scenarios-"))
  roots.push(root)
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), source)
  }
  return { root, parts: discoverParts(root) }
}

/** @param {unknown} composition */
const declaration = composition => `export const composition = ${JSON.stringify(composition)}\n`
/** @param {string} part @param {string} [state] */
const ref = (part, state = "default") => ({ part, state })

function composedProject() {
  return project({
    [cart]: `${defaultSource}export function MissingArt() { return null }`,
    [shelf]: `${defaultSource}${declaration({ default: [ref(cart)] })}`,
    [home]: `${defaultSource}export function Empty() { return null }\nexport function Mixed() { return null }\n${declaration({
      default: [ref(shelf)], Empty: [], Mixed: [ref(cart), ref(cart, "MissingArt"), ref(shelf)],
    })}`,
  })
}

describe("composition discovery", () => {
  test("keeps undeclared parts unchanged", () => {
    expect(project({ [cart]: defaultSource }).parts).toEqual([
      { file: cart, name: "Cart", layer: "molecule", states: [{ export: "default", label: "Default" }] },
    ])
  })

  test("reads literal data and TypeScript wrappers without executing source", () => {
    const { parts } = project({
      [cart]: defaultSource,
      [home]: `${defaultSource}throw new Error("must not execute")\nexport const composition = ({ default: [{ part: "${cart}", state: "default" } as const] } as const) satisfies Composition`,
    })
    expect(parts.find(part => part.file === home)?.composition).toEqual({ default: [ref(cart)] })
    expect(parts.find(part => part.file === home)?.compositionProblems).toBeUndefined()
  })

  test("supports default, named and empty scenarios", () => {
    const { parts } = composedProject()
    expect(parts.find(part => part.file === home)?.composition).toEqual({
      default: [ref(shelf)], Empty: [], Mixed: [ref(cart), ref(cart, "MissingArt"), ref(shelf)],
    })
    expect(parts.every(part => part.compositionProblems === undefined)).toBe(true)
  })

  test.each([
    'export const composition = getComposition()',
    'const cases = {}; export const composition = cases',
    'export const composition = { ...cases }',
    'export const composition = { ["default"]: [] }',
    'export const composition = { default: [child] }',
    'export const composition = { default: [...children] }',
    'export const composition = { default: [], default: [] }',
    'export let composition = {}',
    'export function composition() { return {} }',
    'export const { composition } = cases',
    'export const { other: composition } = cases',
    'export const [composition] = cases',
    'const cases = {}; export { cases as composition }',
    'export { composition } from "./cases"',
    'export * as composition from "./cases"',
    'export const composition = {}; export const composition = {}',
  ])("reports unsupported declarations: %s", source => {
    const { parts } = project({ [home]: `${defaultSource}${source}` })
    expect(parts[0]?.composition).toBeUndefined()
    expect(parts[0]?.compositionProblems?.length).toBeGreaterThan(0)
    expect(parts[0]?.compositionProblems?.[0]).toContain(`${home}:`)
  })

  test.each([
    [], "invalid", { default: "invalid" }, { default: [{}] },
    { default: [{ part: cart }] }, { default: [{ part: cart, state: "" }] },
    { default: [{ part: cart, state: "default", props: {} }] },
  ].map(composition => ({ composition })))("rejects values outside the composition schema: %j", ({ composition }) => {
    const { parts } = project({ [cart]: defaultSource, [home]: defaultSource + declaration(composition) })
    const parent = parts.find(part => part.file === home)
    expect(parent?.composition).toBeUndefined()
    expect(parent?.compositionProblems?.[0]).toContain("composition must map")
  })

  test.each(["/absolute.part.tsx", "../escape.part.tsx", "src/../Cart.molecule.part.tsx", "./src/Cart.molecule.part.tsx", "src//Cart.molecule.part.tsx", "C:/Cart.part.tsx", "src\\Cart.part.tsx", "src/Cart.part.tsx?take=1", "node_modules/Cart.part.tsx", ".caliper/Cart.part.tsx"])(
    "rejects unsafe part paths: %s", path => {
      const { parts } = project({ [home]: defaultSource + declaration({ default: [ref(path)] }) })
      expect(parts[0]?.composition).toBeUndefined()
      expect(parts[0]?.compositionProblems?.[0]).toContain("unsafe part path")
    },
  )

  test("reports missing parent states, child states and parts", () => {
    const { parts } = project({
      [cart]: defaultSource,
      [home]: defaultSource + declaration({ Missing: [ref(cart, "Missing"), ref("src/Absent.part.tsx")] }),
    })
    const parent = parts.find(part => part.file === home)
    expect(parent?.composition).toBeUndefined()
    expect(parent?.compositionProblems).toHaveLength(3)
    expect(parent?.compositionProblems?.join("\n")).toContain("missing state")
    expect(parent?.compositionProblems?.join("\n")).toContain("missing part")
  })

  test("rejects duplicate child references but permits different states of the same child", () => {
    const { parts } = project({
      [cart]: defaultSource,
      [home]: defaultSource + declaration({ default: [ref(cart), ref(cart)] }),
    })
    expect(parts.find(part => part.file === home)?.compositionProblems?.[0]).toContain("repeats")
    expect(composedProject().parts.find(part => part.file === home)?.compositionProblems).toBeUndefined()
  })

  test("reports self references and cycles without publishing cyclic relationships", () => {
    const { parts } = project({
      [cart]: defaultSource + declaration({ default: [ref(shelf)] }),
      [shelf]: defaultSource + declaration({ default: [ref(home)] }),
      [home]: defaultSource + declaration({ default: [ref(cart)] }),
    })
    for (const part of parts) {
      expect(part.composition).toBeUndefined()
      expect(part.compositionProblems?.[0]).toContain("cycle")
    }
    const self = project({ [home]: defaultSource + declaration({ default: [ref(home)] }) }).parts[0]
    expect(self?.composition).toBeUndefined()
    expect(self?.compositionProblems?.[0]).toContain("cannot contain itself")
  })

  test("reports references that become stale after a state is removed", () => {
    const { root, parts } = composedProject()
    expect(parts.find(part => part.file === home)?.compositionProblems).toBeUndefined()
    writeFileSync(join(root, cart), defaultSource)
    const changed = discoverParts(root).find(part => part.file === home)
    expect(changed?.composition).toBeUndefined()
    expect(changed?.compositionProblems?.[0]).toContain('missing state "MissingArt"')
  })
})

describe("scenario graph", () => {
  test("compares complete state identities and checks existence", () => {
    const { parts } = composedProject()
    expect(sameState(ref(cart), ref(cart))).toBe(true)
    expect(sameState(ref(cart), ref(cart, "MissingArt"))).toBe(false)
    expect(sameState(ref(cart), ref(shelf))).toBe(false)
    expect(stateExists(parts, ref(cart, "MissingArt"))).toBe(true)
    expect(stateExists(parts, ref(cart, "Gone"))).toBe(false)
    expect(stateExists(parts, ref("gone.part.tsx"))).toBe(false)
  })

  test("finds transitive children and deduplicates shared descendants", () => {
    const { parts } = composedProject()
    expect(subjectsOf(parts, ref(home))).toEqual([ref(shelf), ref(cart)])
    expect(subjectsOf(parts, ref(home, "Mixed"))).toEqual([ref(cart), ref(cart, "MissingArt"), ref(shelf)])
    expect(subjectsOf(parts, ref(home, "Empty"))).toEqual([])
  })

  test("finds parent contexts for exactly one subject state", () => {
    const { parts } = composedProject()
    expect(contextsFor(parts, ref(cart))).toEqual([ref(home), ref(home, "Mixed"), ref(shelf)])
    expect(contextsFor(parts, ref(cart, "MissingArt"))).toEqual([ref(home, "Mixed")])
  })

  test("related coverage includes all subject states and every distinct declared context", () => {
    const { parts } = composedProject()
    expect(relatedStates(parts, ref(cart, "MissingArt"))).toEqual([
      ref(cart), ref(cart, "MissingArt"), ref(home), ref(home, "Mixed"), ref(shelf),
    ])
    expect(relatedStates(parts, ref(home))).toEqual([ref(home), ref(home, "Empty"), ref(home, "Mixed")])
  })

  test("missing state selections return no relationships", () => {
    const { parts } = composedProject()
    for (const query of [subjectsOf, contextsFor, relatedStates]) {
      expect(query(parts, ref(cart, "Gone"))).toEqual([])
      expect(query(parts, ref("Gone.part.tsx"))).toEqual([])
    }
  })

  test("terminates on cyclic runtime data and ignores stale child references", () => {
    /** @type {Part[]} */
    const parts = [
      { file: cart, name: "Cart", states: [{ export: "default", label: "Default" }], composition: { default: [ref(shelf), ref("Gone.part.tsx")] } },
      { file: shelf, name: "Shelf", states: [{ export: "default", label: "Default" }], composition: { default: [ref(cart)] } },
    ]
    expect(subjectsOf(parts, ref(cart))).toEqual([ref(shelf)])
    expect(contextsFor(parts, ref(cart))).toEqual([ref(shelf)])
    expect(relatedStates(parts, ref(cart))).toEqual([ref(cart), ref(shelf)])
  })

  test("ignores malformed child entries in runtime data", () => {
    const parts = JSON.parse(JSON.stringify(composedProject().parts))
    const parent = parts.find((/** @type {Part} */ part) => part.file === home)
    parent.composition.default = [null, {}, { part: cart }, ref(cart)]
    parent.composition.Mixed = "invalid"
    expect(subjectsOf(parts, ref(home))).toEqual([ref(cart)])
    expect(subjectsOf(parts, ref(home, "Mixed"))).toEqual([])
    expect(subjectsOf(parts, JSON.parse("null"))).toEqual([])
  })
})
