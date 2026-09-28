// @ts-check
import { createHash } from "node:crypto"
import ts from "typescript"

/**
 * Read callback declarations, never their values or imported modules. Invalid
 * declarations expose no partial map: they must fail rather than lose coverage.
 * Value export-star declarations are rejected even for unrelated helpers because
 * their exports cannot be verified here. Type-only export-star declarations are safe.
 * @param {string} file
 * @param {string} source
 * @param {readonly import('../types').PartState[]} states
 * @returns {Pick<import('../types').Part, 'authoredChecks' | 'authoredCheckProblems'>}
 */
export function readAuthoredChecks(file, source, states) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  /** @type {ts.VariableDeclaration[]} */
  const declarations = []
  /** @type {string[]} */
  const problems = []
  /** @param {ts.Node} node */
  const line = node => tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1
  /** @param {ts.Node} node @param {string} reason */
  const problem = (node, reason) => problems.push(`${file}:${line(node)}: checks ${reason}`)
  /** @param {ts.BindingName} binding @returns {boolean} */
  const bindsChecks = binding => ts.isIdentifier(binding) ? binding.text === "checks"
    : binding.elements.some(element => ts.isBindingElement(element) && bindsChecks(element.name))

  for (const statement of tree.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue
      const clause = statement.exportClause
      if (!clause) {
        problem(statement, "static discovery cannot verify wildcard value re-exports. Use explicit named exports and declare checks directly in this part.")
      } else if (ts.isNamedExports(clause)) {
        for (const entry of clause.elements) {
          if (!entry.isTypeOnly && entry.name.text === "checks") problem(entry, "must be declared directly as export const checks = { ... }, not an export alias.")
        }
      } else if (clause && ts.isNamespaceExport(clause) && clause.name.text === "checks") {
        problem(clause, "cannot be a namespace export.")
      }
      continue
    }
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) ?? [] : []
    if (!modifiers.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
    if (modifiers.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) continue
    if (!ts.isVariableStatement(statement)) {
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement)) && statement.name?.text === "checks") {
        problem(statement, "must be an exported const with a literal object initializer.")
      }
      continue
    }
    for (const declaration of statement.declarationList.declarations) {
      if (!bindsChecks(declaration.name)) continue
      if (!ts.isIdentifier(declaration.name)) { problem(declaration, "cannot use a destructuring binding."); continue }
      declarations.push(declaration)
      if (!(statement.declarationList.flags & ts.NodeFlags.Const)) problem(declaration, "must be const.")
    }
  }
  if (!declarations.length && !problems.length) return {}
  if (declarations.length > 1) problem(declarations[1], "is declared more than once.")
  const declaration = declarations[0]
  if (problems.length || !declaration) return { authoredCheckProblems: problems }
  const outer = declaration.initializer && unwrap(declaration.initializer)
  if (!outer || !ts.isObjectLiteralExpression(outer)) {
    problem(declaration, "needs a literal object initializer; imports and calls are not evaluated.")
    return { authoredCheckProblems: problems }
  }
  /** @type {Record<string, readonly import('../authored/contract.js').CheckDeclaration[]>} */
  const authoredChecks = Object.create(null)
  const stateNames = new Set(states.map(state => state.export))
  const seenStates = new Set()
  for (const property of outer.properties) {
    const state = propertyKey(property)
    if (state === null || !ts.isPropertyAssignment(property)) {
      problem(property, "accepts only literal state properties, not spreads, computed keys, getters or shorthand properties.")
      continue
    }
    if (state === "__proto__") {
      problem(property, "__proto__ property assignments set the object prototype, not an own data property.")
      continue
    }
    if (seenStates.has(state)) problem(property, `contains duplicate state "${state}".`)
    seenStates.add(state)
    if (!stateNames.has(state)) problem(property, `names state "${state}" which the part does not export.`)
    const inner = unwrap(property.initializer)
    if (!ts.isObjectLiteralExpression(inner)) {
      problem(property, `for state "${state}" must be a literal object.`)
      continue
    }
    const seenNames = new Set()
    const checks = []
    for (const check of inner.properties) {
      const name = propertyKey(check)
      if (name === null) { problem(check, "accepts only literal check names, not spreads or computed keys."); continue }
      if (name === "__proto__" && ts.isPropertyAssignment(check)) {
        problem(check, "__proto__ property assignments set the object prototype, not an own data property.")
        continue
      }
      if (!name.trim()) problem(check, "names must not be blank.")
      if (seenNames.has(name)) problem(check, `contains duplicate name "${name}" in state "${state}".`)
      seenNames.add(name)
      const callback = ts.isPropertyAssignment(check) ? unwrap(check.initializer) : check
      if (!(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback) || ts.isMethodDeclaration(callback)) || callback.asteriskToken || !callback.body) {
        problem(check, `"${state}.${name}" must be an inline arrow, function expression or method, not a getter, generator or referenced value.`)
        continue
      }
      checks.push({ name, line: line(check), hash: createHash("sha256").update(callback.getText(tree)).digest("hex") })
    }
    authoredChecks[state] = checks
  }
  return problems.length ? { authoredCheckProblems: problems } : { authoredChecks }
}

/** @param {ts.Expression} expression @returns {ts.Expression} */
function unwrap(expression) {
  while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) expression = expression.expression
  return expression
}

/** @param {ts.ObjectLiteralElementLike} property @returns {string | null} */
function propertyKey(property) {
  const name = property.name
  return name && (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) ? name.text : null
}
