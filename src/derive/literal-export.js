// @ts-check
import ts from "typescript"

/**
 * Read a direct literal const export without executing project code. Unsupported
 * declarations remain errors, not absent metadata. Schema validation is separate.
 * @param {string} file
 * @param {string} source
 * @param {string} name
 * @returns {{ _tag: "Absent" } | { _tag: "Invalid", problems: string[] } | { _tag: "Literal", value: unknown, at: string }}
 */
export function readLiteralExport(file, source, name) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  /** @type {ts.VariableDeclaration[]} */
  const declarations = []
  /** @type {string[]} */
  const problems = []
  /** @param {ts.Node} node */
  const at = node => `${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}`
  /** @param {ts.Node} node @param {string} reason */
  const problem = (node, reason) => problems.push(`${at(node)}: ${reason}`)
  /** @param {ts.BindingName} binding @returns {boolean} */
  const binds = binding => ts.isIdentifier(binding) ? binding.text === name
    : binding.elements.some(element => ts.isBindingElement(element) && binds(element.name))
  for (const statement of tree.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue
      const clause = statement.exportClause
      if (clause && ts.isNamedExports(clause)) {
        for (const entry of clause.elements) {
          if (!entry.isTypeOnly && entry.name.text === name) problem(entry, `Declare ${name} directly as export const ${name} = { ... }, not an export alias.`)
        }
      } else if (clause && ts.isNamespaceExport(clause) && clause.name.text === name) {
        problem(clause, `${name} must be literal data, not a namespace export.`)
      }
      continue
    }
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) ?? [] : []
    if (!modifiers.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
    if (!ts.isVariableStatement(statement)) {
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement)) && statement.name?.text === name) {
        problem(statement, `${name} must be an exported const with literal data.`)
      }
      continue
    }
    for (const declaration of statement.declarationList.declarations) {
      if (!binds(declaration.name)) continue
      if (!ts.isIdentifier(declaration.name)) { problem(declaration, `${name} must have a direct literal initializer, not a destructuring binding.`); continue }
      declarations.push(declaration)
      if (!(statement.declarationList.flags & ts.NodeFlags.Const)) problem(declaration, `${name} must be const.`)
    }
  }
  if (!declarations.length && !problems.length) return { _tag: "Absent" }
  if (declarations.length > 1) problem(declarations[1], `${name} is declared more than once.`)
  const declaration = declarations[0]
  if (problems.length || !declaration) return { _tag: "Invalid", problems }
  try {
    if (!declaration.initializer) throw new Error(`${name} needs a literal initializer.`)
    return { _tag: "Literal", value: literal(declaration.initializer, name), at: at(declaration) }
  } catch (error) {
    problem(declaration, error instanceof Error ? error.message : String(error))
    return { _tag: "Invalid", problems }
  }
}

/** @param {ts.Expression} expression @param {string} exportName @returns {unknown} */
function literal(expression, exportName) {
  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isParenthesizedExpression(expression) || ts.isTypeAssertionExpression(expression)) return literal(expression.expression, exportName)
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text
  if (ts.isNumericLiteral(expression)) return Number(expression.text)
  if (ts.isArrayLiteralExpression(expression)) return expression.elements.map(element => literal(element, exportName))
  if (ts.isObjectLiteralExpression(expression)) {
    /** @type {Record<string, unknown>} */
    const value = Object.create(null)
    for (const property of expression.properties) {
      if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
        throw new Error(`${exportName} accepts only literal properties, arrays, strings and numbers. Spreads, computed names and shorthand properties are not supported.`)
      }
      const name = property.name.text
      if (Object.hasOwn(value, name)) throw new Error(`${exportName} contains duplicate property "${name}".`)
      value[name] = literal(property.initializer, exportName)
    }
    return value
  }
  throw new Error(`${exportName} accepts only literal properties, arrays, strings and numbers. Calls, identifiers and other dynamic expressions are not evaluated.`)
}
