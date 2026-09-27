// @ts-check
import ts from "typescript"
import { Check } from "typebox/value"
import { CompositionSchema } from "../scenario-contract.js"
import { sameState, stateExists, subjectsOf } from "../client/scenarios.js"

/** @typedef {import("../types").Part} Part */

/**
 * Read literal composition metadata without evaluating any project code.
 * An unsupported declaration is different from an absent declaration.
 *
 * @param {string} file
 * @param {string} source
 * @returns {Pick<Part, "composition" | "compositionProblems">}
 */
export function readComposition(file, source) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  /** @type {ts.VariableDeclaration[]} */
  const declarations = []
  /** @type {string[]} */
  const problems = []
  /** @param {ts.Node} node @param {string} reason */
  const problem = (node, reason) => problems.push(`${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}: ${reason}`)
  for (const statement of tree.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue
      const clause = statement.exportClause
      if (clause && ts.isNamedExports(clause)) {
        for (const entry of clause.elements) {
          if (!entry.isTypeOnly && entry.name.text === "composition") problem(entry, "Declare composition directly as export const composition = { ... }, not an export alias.")
        }
      } else if (clause && ts.isNamespaceExport(clause) && clause.name.text === "composition") {
        problem(clause, "composition must be literal data, not a namespace export.")
      }
      continue
    }
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) ?? [] : []
    if (!modifiers.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
    if (!ts.isVariableStatement(statement)) {
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement)) && statement.name?.text === "composition") {
        problem(statement, "composition must be an exported const with literal data.")
      }
      continue
    }
    for (const declaration of statement.declarationList.declarations) {
      if (!bindsComposition(declaration.name)) continue
      if (!ts.isIdentifier(declaration.name)) {
        problem(declaration, "composition must have a direct literal initializer, not a destructuring binding.")
        continue
      }
      declarations.push(declaration)
      if (!(statement.declarationList.flags & ts.NodeFlags.Const)) problem(declaration, "composition must be const.")
    }
  }
  if (declarations.length === 0 && problems.length === 0) return {}
  if (declarations.length > 1) problem(declarations[1], "composition is declared more than once.")
  const declaration = declarations[0]
  if (problems.length > 0 || !declaration) return { compositionProblems: problems }
  try {
    if (!declaration.initializer) throw new Error("composition needs a literal initializer.")
    const value = literal(declaration.initializer)
    if (!Check(CompositionSchema, value)) {
      throw new Error('composition must map state exports to arrays of { part: "root-relative.part.tsx", state: "export" } with no extra fields.')
    }
    return { composition: value }
  } catch (error) {
    problem(declaration, error instanceof Error ? error.message : String(error))
    return { compositionProblems: problems }
  }
}

/** @param {ts.BindingName} name @returns {boolean} */
function bindsComposition(name) {
  return ts.isIdentifier(name) ? name.text === "composition"
    : name.elements.some(element => ts.isBindingElement(element) && bindsComposition(element.name))
}

/** @param {ts.Expression} expression @returns {unknown} */
function literal(expression) {
  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isParenthesizedExpression(expression) || ts.isTypeAssertionExpression(expression)) {
    return literal(expression.expression)
  }
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text
  if (ts.isArrayLiteralExpression(expression)) return expression.elements.map(literal)
  if (ts.isObjectLiteralExpression(expression)) {
    /** @type {Record<string, unknown>} */
    const value = Object.create(null)
    for (const property of expression.properties) {
      if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
        throw new Error("composition accepts only literal properties, arrays and strings. Spreads, computed names and shorthand properties are not supported.")
      }
      const name = property.name.text
      if (Object.hasOwn(value, name)) throw new Error(`composition contains duplicate property "${name}".`)
      value[name] = literal(property.initializer)
    }
    return value
  }
  throw new Error("composition accepts only literal properties, arrays and strings. Calls, identifiers and other dynamic expressions are not evaluated.")
}

/** @param {string} path */
function safePartPath(path) {
  return !/[\\:#?\u0000]/.test(path) && path.endsWith(".part.tsx")
    && path.split("/").every(segment => segment !== "" && segment !== "." && segment !== ".." && !["node_modules", ".git", ".caliper"].includes(segment))
}

/**
 * Validate after discovering all parts. Invalid declarations supply no
 * relationships; their errors remain available to Setup and the frame.
 *
 * @param {readonly Part[]} parts
 * @returns {Part[]}
 */
export function validateCompositions(parts) {
  const checked = parts.map(part => {
    if (part.composition === undefined) return part
    /** @type {string[]} */
    const problems = []
    for (const [state, children] of Object.entries(part.composition)) {
      const parent = { part: part.file, state }
      const at = `${part.file}: composition.${state}`
      if (!stateExists(parts, parent)) problems.push(`${at} names a state the part does not export.`)
      const seen = new Set()
      for (const child of children) {
        if (!safePartPath(child.part)) problems.push(`${at} has unsafe part path "${child.part}". Use a Vite-root-relative part path without traversal or URL syntax.`)
        else if (!parts.some(part => part.file === child.part)) problems.push(`${at} names missing part "${child.part}".`)
        else if (!stateExists(parts, child)) problems.push(`${at} names missing state "${child.state}" in ${child.part}.`)
        if (sameState(parent, child)) problems.push(`${at} cannot contain itself.`)
        const key = JSON.stringify([child.part, child.state])
        if (seen.has(key)) problems.push(`${at} repeats ${child.part} state "${child.state}". Declare each child state once, even when several instances use it.`)
        seen.add(key)
      }
    }
    return problems.length === 0 ? part : invalid(part, problems)
  })
  return checked.map(part => {
    if (part.composition === undefined) return part
    const problems = Object.entries(part.composition).flatMap(([state, children]) => {
      const parent = { part: part.file, state }
      return children.filter(child => subjectsOf(checked, child).some(descendant => sameState(descendant, parent)))
        .map(child => `${part.file}: composition.${state} forms a cycle through ${child.part} state "${child.state}".`)
    })
    return problems.length === 0 ? part : invalid(part, problems)
  })
}

/** @param {Part} part @param {string[]} problems @returns {Part} */
function invalid(part, problems) {
  const { composition: _composition, ...rest } = part
  return { ...rest, compositionProblems: [...(part.compositionProblems ?? []), ...problems] }
}
