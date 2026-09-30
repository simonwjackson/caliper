import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import ts from "typescript"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readPart } from "../src/derive/parts.js"

const root = new URL("../", import.meta.url).pathname
const ui = join(root, "src/client/ui")
/**
 * Files in the UI directory that are not chrome components:
 * the frozen contract and hooks, the unstyled reference renderer the frozen
 * contract gate still runs, the pure layout policy, the box hook, and the
 * fixtures (local inputs and the part preview scope, not product components).
 */
const NOT_COMPONENTS = new Set(["contract.ts", "hooks.ts", "Chrome.tsx", "layout.ts", "useBox.ts", "editor-appearance.ts"])
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)])
const files = walk(ui).map(file => relative(ui, file))
const components = files.filter(file => file.endsWith(".tsx") && !file.endsWith(".part.tsx") && !file.startsWith("fixtures/") && !NOT_COMPONENTS.has(file))
const parts = files.filter(file => file.endsWith(".part.tsx"))

/** Top-level components a file declares: capitalised functions, and capitalised consts set to a function or memo(). */
function declaredComponents(file: string, source = readFileSync(join(ui, file), "utf8")): string[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const names: string[] = []
  for (const statement of tree.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && /^[A-Z]/.test(statement.name.text)) names.push(statement.name.text)
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !/^[A-Z]/.test(declaration.name.text) || !declaration.initializer) continue
      const value = declaration.initializer
      if (ts.isArrowFunction(value) || ts.isFunctionExpression(value) || (ts.isCallExpression(value) && value.expression.getText(tree) === "memo")) names.push(declaration.name.text)
    }
  }
  return names
}

describe("Darkroom decomposition", () => {
  test("every chrome component has a part beside it", () => {
    const missing = components.filter(file => {
      const base = file.replace(/\.tsx$/, "")
      return !parts.some(part => part.startsWith(`${base}.`) && /\.(page|template|organism|molecule|atom)\.part\.tsx$/.test(part))
    })
    expect(missing).toEqual([])
  })
  test("no component file holds a second component", () => {
    const crowded = components.map(file => ({ file, names: declaredComponents(file) })).filter(entry => entry.names.length !== 1)
    expect(crowded).toEqual([])
  })
  test("the chrome is decomposed at page, organism, molecule and atom level", () => {
    const levels = new Set(parts.map(part => /\.(page|template|organism|molecule|atom)\.part\.tsx$/.exec(part)?.[1]))
    for (const level of ["page", "organism", "molecule", "atom"]) expect(levels).toContain(level)
  })
  test("every part names itself, notes what it shows, and has a default state", () => {
    for (const file of parts) {
      const source = readFileSync(join(ui, file), "utf8")
      expect(source, file).toMatch(/^export const name = "/m)
      expect(source, file).toMatch(/^export const note = "/m)
      expect(source, file).toMatch(/^export default function [A-Z]/m)
      const part = readPart(root, `src/client/ui/${file}`)
      expect(part.layer, file).toBeDefined()
      expect(part.states.length, file).toBeGreaterThanOrEqual(1)
    }
  })
  test("the gate bites: a file with two components is found", () => {
    expect(declaredComponents("atoms/Button.tsx")).toEqual(["Button"])
    expect(declaredComponents("canvas/DeviceFrame.tsx")).toEqual(["DeviceFrame"])
    const crowded = "export function Row() { return null }\nfunction Chip() { return null }\nconst Badge = memo(function Badge() { return null })\nconst helper = () => 1\n"
    expect(declaredComponents("Crowded.tsx", crowded)).toEqual(["Row", "Chip", "Badge"])
  })
})

describe("every part state renders its region's content from its local fixture", () => {
  for (const file of parts) {
    test(file, async () => {
      const module = await import(join(ui, file)) as Record<string, unknown>
      const states = Object.entries(module).filter(([key, value]) => (key === "default" || /^[A-Z]/.test(key)) && typeof value === "function")
      expect(states.length).toBeGreaterThan(0)
      for (const [key, state] of states) {
        const html = renderToStaticMarkup(createElement(state as () => null))
        // A part must render content, not merely mount: text or a behavioral hook.
        expect(html.replace(/<[^>]+>/g, "").trim().length + (html.match(/data-cal="|<svg|<iframe/g)?.length ?? 0), `${file} ${key}`).toBeGreaterThan(0)
      }
    })
  }
})
