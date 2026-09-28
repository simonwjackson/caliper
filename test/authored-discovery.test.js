// @ts-check
import { expect, test } from "bun:test"
import { readPart } from "../src/derive/parts.js"
import { readAuthoredChecks } from "../src/derive/authored-checks.js"

const file = "src/Library.part.tsx"
const component = "export default function Library() { return null }\nexport const ErrorState = () => null\n"
/** @param {string} declaration */
const read = declaration => readPart("/unused", file, component + declaration)

test("discovers literal named callbacks and locations without executing source", () => {
  const part = read(`throw new Error('must never execute')
export const checks = ({
  default: { "loads library": async ({ canvas }) => { await import('./helper'); canvas.getByRole('heading') } },
  ErrorState: {
    "retries": (function () { throw new Error('not during discovery') }),
    async "uses real input"() {},
  } as const,
} as const) satisfies StateChecks`)
  expect(part.authoredCheckProblems).toBeUndefined()
  expect(part.states.map(state => state.export)).toEqual(["default", "ErrorState"])
  expect(part.authoredChecks?.default?.[0]).toMatchObject({ name: "loads library", line: 5 })
  expect(part.authoredChecks?.ErrorState?.map(check => check.name)).toEqual(["retries", "uses real input"])
  expect(part.authoredChecks?.default?.[0]?.hash).toMatch(/^[a-f0-9]{64}$/)
})

test("missing and empty declarations remain distinguishable from invalid declarations", () => {
  expect(readAuthoredChecks(file, component, [{ export: "default", label: "Default" }])).toEqual({})
  expect(read("export const checks = {}").authoredChecks).toEqual({})
  expect(read("export const checks = { default: {} }").authoredChecks).toEqual({ default: [] })
  expect(read("export type checks = {}; export { type X as checks } from './types'").authoredCheckProblems).toBeUndefined()
  expect(readAuthoredChecks(file, "export default function checks() {}", [{ export: "default", label: "Default" }])).toEqual({})
})

test("wildcard value re-exports fail static discovery instead of hiding imported checks", () => {
  for (const source of [
    "export * from './checks-helper'",
    "export * from './unrelated-helper'",
    "export * from './checks-helper'; export const checks = { default: { works() {} } }",
  ]) {
    const part = read(source)
    expect(part.authoredChecks).toBeUndefined()
    expect(part.authoredCheckProblems).toEqual([
      `${file}:3: checks static discovery cannot verify wildcard value re-exports. Use explicit named exports and declare checks directly in this part.`,
    ])
  }
  for (const source of ["export type * from './types'", "export type * as checks from './types'"]) {
    expect(readAuthoredChecks(file, source, [])).toEqual({})
    const part = read(`${source}; export const checks = { default: { works() {} } }`)
    expect(part.authoredCheckProblems).toBeUndefined()
    expect(part.authoredChecks?.default?.[0]?.name).toBe("works")
  }
})

test("prototype setter properties never become runnable check or state declarations", () => {
  // These are JavaScript prototype setters even when the property name is quoted.
  const stateSetter = { "__proto__": { works() {} } }
  const checkSetter = { "__proto__": () => {} }
  expect(Object.hasOwn(stateSetter, "__proto__")).toBe(false)
  expect(Object.hasOwn(checkSetter, "__proto__")).toBe(false)
  expect(Object.hasOwn({ "__proto__"() {} }, "__proto__")).toBe(true)

  for (const key of ["__proto__", "'__proto__'", '"__proto__"']) {
    const outer = readAuthoredChecks(file, `export const checks = { ${key}: { works() {} } }`, [{ export: "__proto__", label: "Prototype" }])
    const inner = read(`export const checks = { default: { ${key}: () => {} } }`)
    for (const parsed of [outer, inner]) {
      expect(parsed.authoredChecks).toBeUndefined()
      expect(parsed.authoredCheckProblems?.[0]).toContain("__proto__ property assignments set the object prototype, not an own data property.")
      expect(parsed.authoredCheckProblems?.[0]).toMatch(/^src\/Library\.part\.tsx:\d+:/)
    }
  }
  const method = read("export const checks = { default: { '__proto__'() {} } }")
  expect(method.authoredCheckProblems).toBeUndefined()
  expect(method.authoredChecks?.default?.[0]?.name).toBe("__proto__")
})

test("declaration hashes track callback source, not unrelated part text or source line", () => {
  const declaration = "export const checks = { default: { works: () => helper('original') } }"
  const original = read(declaration).authoredChecks?.default?.[0]?.hash
  expect(read("\n\n" + declaration).authoredChecks?.default?.[0]?.hash).toBe(original)
  expect(read(declaration.replace("original", "changed")).authoredChecks?.default?.[0]?.hash).not.toBe(original)
})

test("invalid checks report file and line and expose no partial check map", () => {
  for (const declaration of [
    "export let checks = {}",
    "export const checks = importedChecks",
    "export const checks = makeChecks()",
    "export const checks = { ...checksElsewhere }",
    "export const checks = { [state]: {} }",
    "export const checks = { Missing: {} }",
    "export const checks = { default: importedChecks }",
    "export const checks = { default: { ...importedChecks } }",
    "export const checks = { default: { [name]: () => {} } }",
    "export const checks = { default: { '  ': () => {} } }",
    "export const checks = { default: { value: 42 } }",
    "export const checks = { default: { callback } }",
    "export const checks = { default: { callback: importedCallback } }",
    "export const checks = { default: { get callback() { return () => {} } } }",
    "export const checks = { get default() { return {} } }",
    "export const checks = { default: {}, default: {} }",
    "export const checks = { default: { same() {}, 'same': () => {} } }",
    "export const checks = {}; export const checks = {}",
    "export { importedChecks as checks } from './helpers'",
    "export * as checks from './helpers'",
    "export function checks() {}",
    "export class checks {}",
    "export const { checks } = importedChecks",
    "export const checks = { default: { *generator() {} } }",
    "export const checks = { default: { generator: function*() {} } }",
  ]) {
    const part = read(declaration)
    expect(part.authoredChecks, declaration).toBeUndefined()
    expect(part.authoredCheckProblems?.length, declaration).toBeGreaterThan(0)
    expect(part.authoredCheckProblems?.[0], declaration).toMatch(/^src\/Library\.part\.tsx:\d+:/)
  }
})

test("take-only states validate against supplied source and prototype-like names stay literal", () => {
  const declaration = "export const checks = { TakeOnly: { constructor() {}, '__proto__'() {} } }"
  expect(read(declaration).authoredCheckProblems?.[0]).toContain("TakeOnly")
  const part = read("export function TakeOnly() { return null }\n" + declaration)
  expect(part.authoredCheckProblems).toBeUndefined()
  expect(part.authoredChecks?.TakeOnly?.map(check => check.name)).toEqual(["constructor", "__proto__"])
})
