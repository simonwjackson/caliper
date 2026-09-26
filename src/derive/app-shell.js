// @ts-check
import { readFileSync } from "node:fs"
import { relative } from "node:path"
import ts from "typescript"

/**
 * @typedef {import("../types").SourceSite} SourceSite
 * @typedef {import("../types").GlobalCss} GlobalCss
 * @typedef {import("../types").GlobalStylesheet} GlobalStylesheet
 * @typedef {import("../types").UnresolvedImport} UnresolvedImport
 * @typedef {import("../types").Wrapper} Wrapper
 * @typedef {import("../types").WrapperElement} WrapperElement
 * @typedef {import("../types").Derivation<GlobalCss>} CssDerivation
 * @typedef {import("../types").Derivation<Wrapper>} WrapperDerivation
 * @typedef {import("../types").Resolve} Resolve
 *
 * @typedef {{ file: string, source: ts.SourceFile }} Module
 * @typedef {{ specifier: string, line: number, sideEffectOnly: boolean }} StaticImport
 * @typedef {{ ok: true, value: WrapperElement[], at: SourceSite } | { ok: false, reason: string }} ShellRead
 */

const CSS_FILE = /\.(css|scss|sass|less|styl|stylus|pcss|postcss|sss)$/
const SCRIPT_FILE = /\.(m|c)?(t|j)sx?$/
const WRAP_HINT = 'Set caliper({ wrap: "class-a class-b" }) in vite.config to name the class names of the app\'s outer element, or caliper({ wrap: false }) for none.'

/**
 * Read what the app puts around every component, without running any of its
 * JavaScript.
 *
 * Caliper follows the entry's static imports, the way the browser would load
 * them. It collects each stylesheet imported for its side effect, in load
 * order. It also finds the `createRoot(...).render(<App />)` call and reads the
 * DOM elements `App` returns outermost, when their `className` is a literal.
 *
 * @param {{ root: string, entry: string, resolve: Resolve }} input
 *   `entry` is relative to `root`
 * @returns {Promise<{ css: CssDerivation, wrapper: WrapperDerivation, files: string[] }>}
 *   `files` lists every module read, so the caller knows when to read again
 */
export async function readAppShell({ root, entry, resolve }) {
  const walk = await walkImports(root, `${root}/${entry}`, resolve)
  return {
    css: {
      _tag: "Derived",
      value: { stylesheets: walk.stylesheets, unresolved: walk.unresolved },
      source: { file: entry, line: 1 },
      via: "stylesheets imported for their side effect, reachable from the entry",
    },
    wrapper: await readWrapper(root, walk.modules, resolve),
    files: walk.modules.map(module => module.file),
  }
}

/**
 * Depth-first over static imports, in source order. A stylesheet's position
 * in the result is the position where the browser would evaluate it.
 *
 * @param {string} root
 * @param {string} entry absolute
 * @param {Resolve} resolve
 */
async function walkImports(root, entry, resolve) {
  /** @type {Module[]} */
  const modules = []
  /** @type {GlobalStylesheet[]} */
  const stylesheets = []
  /** @type {UnresolvedImport[]} */
  const unresolved = []
  const seen = new Set()
  const seenCss = new Set()

  /** @param {string} file */
  const visit = async file => {
    if (seen.has(file)) return
    seen.add(file)
    const source = parse(file)
    modules.push({ file, source })
    for (const found of staticImports(source)) {
      const at = { file: siteFile(root, file), line: found.line }
      const resolved = await resolve(found.specifier, file)
      if (resolved === null) {
        unresolved.push({ specifier: found.specifier, at })
        continue
      }
      if (CSS_FILE.test(resolved)) {
        if (found.sideEffectOnly && !found.specifier.includes("?") && !seenCss.has(resolved)) {
          seenCss.add(resolved)
          stylesheets.push({ file: siteFile(root, resolved), importedAt: at })
        }
        continue
      }
      if (SCRIPT_FILE.test(resolved) && !resolved.includes("/node_modules/")) await visit(resolved)
    }
  }

  await visit(entry)
  return { modules, stylesheets, unresolved }
}

/**
 * @param {string} file absolute
 * @returns {ts.SourceFile}
 */
function parse(file) {
  const kind = file.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : /\.(m|c)?ts$/.test(file)
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JSX
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, kind)
}

/**
 * Imports and re-exports that survive compilation. Type-only forms do not.
 *
 * @param {ts.SourceFile} source
 * @returns {StaticImport[]}
 */
function staticImports(source) {
  /** @type {StaticImport[]} */
  const found = []
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (statement.importClause?.isTypeOnly) continue
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue
      found.push({
        specifier: statement.moduleSpecifier.text,
        line: lineOf(source, statement),
        sideEffectOnly: statement.importClause === undefined,
      })
    } else if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly || !statement.moduleSpecifier) continue
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue
      found.push({
        specifier: statement.moduleSpecifier.text,
        line: lineOf(source, statement),
        sideEffectOnly: false,
      })
    }
  }
  return found
}

/**
 * @param {string} root
 * @param {Module[]} modules in the order the walk reached them
 * @param {Resolve} resolve
 * @returns {Promise<WrapperDerivation>}
 */
async function readWrapper(root, modules, resolve) {
  const call = findRenderCall(modules)
  if (call === null) {
    return {
      _tag: "Failed",
      reason: "Caliper found no createRoot(...).render(<App />) or hydrateRoot(..., <App />) reachable from the entry.",
      hint: WRAP_HINT,
    }
  }
  const renderedAt = { file: siteFile(root, call.module.file), line: lineOf(call.module.source, call.jsx) }
  const shell = await readShell(root, call.module, call.jsx, resolve)
  if (!shell.ok) {
    return { _tag: "Failed", reason: `${shell.reason} (rendered at ${renderedAt.file}:${renderedAt.line})`, hint: WRAP_HINT }
  }
  return {
    _tag: "Derived",
    value: { elements: shell.value, renderedAt },
    source: shell.at,
    via: "outermost DOM elements of the component the app renders",
  }
}

/**
 * The first `render(<X />)` on a React root, in walk order.
 *
 * @param {Module[]} modules
 * @returns {{ module: Module, jsx: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment } | null}
 */
function findRenderCall(modules) {
  for (const module of modules) {
    const roots = reactRootImports(module.source)
    if (roots.createRoot.size === 0 && roots.hydrateRoot.size === 0) continue
    /** @type {ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment | null} */
    let found = null
    /** @param {ts.Node} node */
    const search = node => {
      if (found) return
      if (ts.isCallExpression(node)) {
        const callee = node.expression
        const rendered =
          ts.isPropertyAccessExpression(callee) && callee.name.text === "render" && roots.createRoot.size > 0
            ? node.arguments[0]
            : ts.isIdentifier(callee) && roots.hydrateRoot.has(callee.text)
              ? node.arguments[1]
              : undefined
        const jsx = rendered === undefined ? null : asJsx(rendered)
        if (jsx) {
          found = jsx
          return
        }
      }
      ts.forEachChild(node, search)
    }
    search(module.source)
    if (found) return { module, jsx: found }
  }
  return null
}

/**
 * Local names bound to `createRoot` and `hydrateRoot` from "react-dom/client".
 *
 * @param {ts.SourceFile} source
 */
function reactRootImports(source) {
  const roots = { createRoot: new Set(), hydrateRoot: new Set() }
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue
    if (!ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== "react-dom/client") continue
    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text
      if (imported === "createRoot" || imported === "hydrateRoot") roots[imported].add(element.name.text)
    }
  }
  return roots
}

/**
 * Read the DOM shell of the JSX passed to `render`. A component at the top is
 * followed once, to the JSX it returns; a second component is not followed,
 * because Caliper cannot rebuild a component without running it.
 *
 * @param {string} root
 * @param {Module} module
 * @param {ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment} jsx
 * @param {Resolve} resolve
 * @returns {Promise<ShellRead>}
 */
async function readShell(root, module, jsx, resolve) {
  const top = unwrapFragment(jsx)
  if (!top.ok) return top
  const tag = tagName(top.value)
  if (isIntrinsic(tag)) return domChain(root, module, top.value)
  if (!/^[A-Za-z_$][\w$]*$/.test(tag)) return { ok: false, reason: `The app renders <${tag}>, which Caliper cannot follow.` }

  const component = await findComponent(module, tag, resolve)
  if (component === null) return { ok: false, reason: `Caliper could not find the definition of <${tag}>.` }
  const returned = returnedJsx(component.body)
  if (returned === null) {
    return { ok: false, reason: `<${tag}> in ${siteFile(root, component.module.file)} returns no JSX Caliper can read.` }
  }
  const inner = unwrapFragment(returned)
  if (!inner.ok) return inner
  const innerTag = tagName(inner.value)
  if (!isIntrinsic(innerTag)) {
    const line = lineOf(component.module.source, inner.value)
    return {
      ok: false,
      reason: `<${tag}> returns <${innerTag}> at ${siteFile(root, component.module.file)}:${line}. That is a component, and Caliper reads only DOM elements.`,
    }
  }
  return domChain(root, component.module, inner.value)
}

/**
 * The outermost DOM element, then its only child while that child is also a
 * DOM element.
 *
 * @param {string} root
 * @param {Module} module
 * @param {ts.JsxElement | ts.JsxSelfClosingElement} element
 * @returns {ShellRead}
 */
function domChain(root, module, element) {
  /** @type {WrapperElement[]} */
  const chain = []
  /** @type {ts.JsxElement | ts.JsxSelfClosingElement | null} */
  let current = element
  while (current !== null) {
    const className = literalClassName(current)
    if (!className.ok) {
      const line = lineOf(module.source, current)
      return { ok: false, reason: `The className at ${siteFile(root, module.file)}:${line} is computed, so Caliper cannot read it without running the app.` }
    }
    chain.push({ tag: tagName(current), className: className.value })
    current = onlyDomChild(current)
  }
  return { ok: true, value: chain, at: { file: siteFile(root, module.file), line: lineOf(module.source, element) } }
}

/**
 * @param {ts.JsxElement | ts.JsxSelfClosingElement} element
 * @returns {ts.JsxElement | ts.JsxSelfClosingElement | null}
 */
function onlyDomChild(element) {
  if (!ts.isJsxElement(element)) return null
  const children = element.children.filter(child => !(ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces))
  if (children.length !== 1) return null
  const [child] = children
  if (child === undefined || !(ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child))) return null
  return isIntrinsic(tagName(child)) ? child : null
}

/**
 * @param {ts.JsxElement | ts.JsxSelfClosingElement} element
 * @returns {{ ok: true, value: string } | { ok: false }}
 */
function literalClassName(element) {
  const attributes = ts.isJsxElement(element) ? element.openingElement.attributes : element.attributes
  for (const attribute of attributes.properties) {
    if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== "className") continue
    const value = attribute.initializer
    if (value === undefined) return { ok: false }
    if (ts.isStringLiteral(value)) return { ok: true, value: value.text }
    if (ts.isJsxExpression(value) && value.expression) {
      const expression = skipParentheses(value.expression)
      if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
        return { ok: true, value: expression.text }
      }
    }
    return { ok: false }
  }
  return { ok: true, value: "" }
}

/**
 * @param {ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment} jsx
 * @returns {{ ok: true, value: ts.JsxElement | ts.JsxSelfClosingElement } | { ok: false, reason: string }}
 */
function unwrapFragment(jsx) {
  if (!ts.isJsxFragment(jsx)) return { ok: true, value: jsx }
  const children = jsx.children.filter(child => !(ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces))
  const [child] = children
  if (children.length === 1 && child !== undefined && (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child))) {
    return { ok: true, value: child }
  }
  return { ok: false, reason: "The app renders a fragment with more than one child, so it has no single outer element." }
}

/**
 * Find the function that defines `name`, in this module or where it is imported from.
 *
 * @param {Module} module
 * @param {string} name
 * @param {Resolve} resolve
 * @returns {Promise<{ module: Module, body: ts.ConciseBody } | null>}
 */
async function findComponent(module, name, resolve) {
  const local = localFunction(module.source, name)
  if (local) return { module, body: local }
  const imported = importedBinding(module.source, name)
  if (imported === null) return null
  return exportedFunction(module.file, imported.specifier, imported.exportName, resolve, 0)
}

/**
 * @param {string} importer
 * @param {string} specifier
 * @param {string} exportName "default" for a default import
 * @param {Resolve} resolve
 * @param {number} depth
 * @returns {Promise<{ module: Module, body: ts.ConciseBody } | null>}
 */
async function exportedFunction(importer, specifier, exportName, resolve, depth) {
  if (depth > 8) return null
  const file = await resolve(specifier, importer)
  if (file === null || !SCRIPT_FILE.test(file) || file.includes("/node_modules/")) return null
  const module = { file, source: parse(file) }
  for (const statement of module.source.statements) {
    if (exportName === "default" && ts.isFunctionDeclaration(statement) && hasModifier(statement, ts.SyntaxKind.DefaultKeyword) && statement.body) {
      return { module, body: statement.body }
    }
    if (exportName === "default" && ts.isExportAssignment(statement) && !statement.isExportEquals) {
      const body = functionBody(statement.expression) ?? (ts.isIdentifier(statement.expression) ? localFunction(module.source, statement.expression.text) : null)
      if (body) return { module, body }
    }
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        if (element.name.text !== exportName) continue
        const original = (element.propertyName ?? element.name).text
        if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
          return exportedFunction(file, statement.moduleSpecifier.text, original, resolve, depth + 1)
        }
        const body = localFunction(module.source, original)
        if (body) return { module, body }
      }
    }
  }
  if (exportName !== "default") {
    const body = localFunction(module.source, exportName)
    if (body) return { module, body }
  }
  return null
}

/**
 * @param {ts.SourceFile} source
 * @param {string} name
 * @returns {ts.ConciseBody | null}
 */
function localFunction(source, name) {
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name && statement.body) return statement.body
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name || !declaration.initializer) continue
        const body = functionBody(declaration.initializer)
        if (body) return body
      }
    }
  }
  return null
}

/**
 * The body of a function expression, also inside `memo(...)` or `forwardRef(...)`.
 *
 * @param {ts.Expression} expression
 * @returns {ts.ConciseBody | null}
 */
function functionBody(expression) {
  const inner = skipParentheses(expression)
  if (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) return inner.body
  if (ts.isCallExpression(inner) && inner.arguments.length >= 1) {
    const callee = inner.expression.getText()
    const first = inner.arguments[0]
    if (first && /(^|\.)(memo|forwardRef)$/.test(callee)) return functionBody(first)
  }
  return null
}

/**
 * @param {ts.SourceFile} source
 * @param {string} name
 * @returns {{ specifier: string, exportName: string } | null}
 */
function importedBinding(source, name) {
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue
    const clause = statement.importClause
    if (!clause) continue
    const specifier = statement.moduleSpecifier.text
    if (clause.name?.text === name) return { specifier, exportName: "default" }
    const bindings = clause.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const element of bindings.elements) {
      if (element.name.text === name) return { specifier, exportName: (element.propertyName ?? element.name).text }
    }
  }
  return null
}

/**
 * The JSX of the last `return` in the function, not counting nested
 * functions. An arrow function with an expression body returns that expression.
 *
 * @param {ts.ConciseBody} body
 * @returns {ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment | null}
 */
function returnedJsx(body) {
  if (!ts.isBlock(body)) return asJsx(body)
  /** @type {ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment | null} */
  let last = null
  /** @param {ts.Node} node */
  const search = node => {
    if (ts.isFunctionLike(node)) return
    if (ts.isReturnStatement(node) && node.expression) {
      const jsx = asJsx(node.expression)
      if (jsx) last = jsx
    }
    ts.forEachChild(node, search)
  }
  ts.forEachChild(body, search)
  return last
}

/**
 * @param {ts.Node} node
 * @returns {ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment | null}
 */
function asJsx(node) {
  const inner = ts.isExpression(node) ? skipParentheses(node) : node
  return ts.isJsxElement(inner) || ts.isJsxSelfClosingElement(inner) || ts.isJsxFragment(inner) ? inner : null
}

/**
 * @param {ts.Expression} expression
 * @returns {ts.Expression}
 */
function skipParentheses(expression) {
  let current = expression
  while (ts.isParenthesizedExpression(current)) current = current.expression
  return current
}

/** @param {ts.JsxElement | ts.JsxSelfClosingElement} element */
function tagName(element) {
  return (ts.isJsxElement(element) ? element.openingElement.tagName : element.tagName).getText()
}

/** @param {string} tag */
function isIntrinsic(tag) {
  return /^[a-z]/.test(tag) && !tag.includes(".")
}

/**
 * @param {ts.Node} node
 * @param {ts.SyntaxKind} kind
 */
function hasModifier(node, kind) {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some(modifier => modifier.kind === kind)
}

/**
 * @param {ts.SourceFile} source
 * @param {ts.Node} node
 */
function lineOf(source, node) {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
}

/**
 * @param {string} root
 * @param {string} file absolute
 */
function siteFile(root, file) {
  return relative(root, file).replaceAll("\\", "/")
}
