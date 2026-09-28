// @ts-check

/**
 * The knobs' work inside one device frame's live CSSOM (decision 23). The
 * chrome runs this against a frame's document; frames share the chrome's
 * origin. Rules come from another window, so `instanceof` does not work
 * across them: rule kinds are read from their interface names.
 *
 * @typedef {{ id: string, node: Element, sheet: CSSStyleSheet }} ProjectSheet
 *   A stylesheet Vite served for a project file, named by `data-vite-dev-id`.
 * @typedef {import("../knobs/locate.js").RuleSummary} RuleSummary
 * @typedef {{ name: string, syntax: string, inherits: boolean, initialValue: string, sheetId: string, path: number[] }} Registration
 * @typedef {{ sheetId: string, path: number[], selector: string, value: string, priority: string, rule: CSSStyleRule }} Candidate
 *   One style rule that declares a property.
 * @typedef {{ sheetId: string, path: number[], property: string, name: string, selector: string, syntax?: string, inherits?: boolean }} Site
 *   The declaration a knob edits: a custom property in a style rule, or
 *   `initial-value` in the `@property` rule of `name`. For the `@container`
 *   property, the condition of the `@container` rule at `path`; `selector`
 *   then holds the condition as the browser read it from the file.
 * @typedef {{ sheetId: string, path: number[], rule: CSSContainerRule }} ContainerSite
 */

/** The CSSOM interfaces, by the at-rule each stands for. */
const KINDS = /** @type {Record<string, string>} */ ({
  CSSStyleRule: "style",
  CSSMediaRule: "media",
  CSSSupportsRule: "supports",
  CSSContainerRule: "container",
  CSSPropertyRule: "property",
  CSSKeyframesRule: "keyframes",
  CSSFontFaceRule: "font-face",
  CSSImportRule: "import",
  CSSLayerBlockRule: "layer",
  CSSLayerStatementRule: "layer",
  CSSPageRule: "page",
  CSSNamespaceRule: "namespace",
  CSSCounterStyleRule: "counter-style",
  CSSFontFeatureValuesRule: "font-feature-values",
  CSSFontPaletteValuesRule: "font-palette-values",
  CSSScopeRule: "scope",
  CSSStartingStyleRule: "starting-style",
  CSSViewTransitionRule: "view-transition",
  CSSPositionTryRule: "position-try",
})

/** @param {CSSRule} rule */
export function kindOf(rule) {
  return KINDS[rule.constructor.name] ?? "unknown"
}

/**
 * @param {Document} document
 * @returns {ProjectSheet[]}
 */
export function projectSheets(document) {
  /** @type {ProjectSheet[]} */
  const sheets = []
  for (const sheet of document.styleSheets) {
    const node = sheet.ownerNode
    const id = node && "getAttribute" in node ? /** @type {Element} */ (node).getAttribute("data-vite-dev-id") : null
    if (id && node) sheets.push({ id, node: /** @type {Element} */ (node), sheet: /** @type {CSSStyleSheet} */ (sheet) })
  }
  return sheets
}

/**
 * Every rule with its index at each level. Keyframes are not descended: their
 * frames are not rules a knob edits.
 *
 * @param {CSSRuleList} list
 * @param {number[]} [at]
 * @returns {Generator<{ rule: CSSRule, path: number[] }>}
 */
export function* walk(list, at = []) {
  for (let index = 0; index < list.length; index++) {
    const rule = /** @type {CSSRule} */ (list[index])
    const path = [...at, index]
    yield { rule, path }
    const kind = kindOf(rule)
    if (kind !== "keyframes" && "cssRules" in rule) yield* walk(/** @type {CSSGroupingRule} */ (rule).cssRules, path)
  }
}

/**
 * The CSSOM of one sheet, as the knobs API pairs it with the served text.
 *
 * @param {CSSStyleSheet} sheet
 * @returns {RuleSummary[]}
 */
export function summarize(sheet) {
  return [...walk(sheet.cssRules)].map(({ rule, path }) => {
    const kind = kindOf(rule)
    if (kind === "style") return { path, kind, selector: /** @type {CSSStyleRule} */ (rule).selectorText }
    if (kind === "property") return { path, kind, name: /** @type {CSSPropertyRule} */ (rule).name }
    return { path, kind }
  })
}

/**
 * @param {CSSStyleSheet} sheet
 * @param {number[]} path
 * @returns {CSSRule | null}
 */
export function ruleAt(sheet, path) {
  /** @type {CSSRuleList | null} */
  let list = sheet.cssRules
  /** @type {CSSRule | null} */
  let rule = null
  for (const index of path) {
    if (list === null || index >= list.length) return null
    rule = /** @type {CSSRule} */ (list[index])
    list = "cssRules" in rule ? /** @type {CSSGroupingRule} */ (rule).cssRules : null
  }
  return rule
}

/**
 * The registered custom properties, as the cascade sees them: the last
 * `@property` for a name wins.
 *
 * @param {Document} document
 * @returns {Map<string, Registration>}
 */
export function registrations(document) {
  /** @type {Map<string, Registration>} */
  const found = new Map()
  for (const { id, sheet } of projectSheets(document)) {
    for (const { rule, path } of walk(sheet.cssRules)) {
      if (kindOf(rule) !== "property") continue
      const property = /** @type {CSSPropertyRule} */ (rule)
      found.set(property.name, { name: property.name, syntax: property.syntax, inherits: property.inherits, initialValue: property.initialValue ?? "", sheetId: id, path })
    }
  }
  return found
}

/**
 * Custom properties that a `@keyframes` rule sets, and the rule's name.
 *
 * @param {Document} document
 * @returns {Map<string, string>}
 */
export function animatedProperties(document) {
  /** @type {Map<string, string>} */
  const found = new Map()
  for (const { sheet } of projectSheets(document)) {
    for (const { rule } of walk(sheet.cssRules)) {
      if (kindOf(rule) !== "keyframes") continue
      const keyframes = /** @type {CSSKeyframesRule} */ (rule)
      for (const frame of keyframes.cssRules) {
        for (const name of /** @type {CSSKeyframeRule} */ (frame).style) if (name.startsWith("--")) found.set(name, keyframes.name)
      }
    }
  }
  return found
}

/**
 * Every style rule that declares `property`.
 *
 * @param {Document} document
 * @param {string} property
 * @returns {Candidate[]}
 */
export function declarationsOf(document, property) {
  /** @type {Candidate[]} */
  const found = []
  for (const { id, sheet } of projectSheets(document)) {
    for (const { rule, path } of walk(sheet.cssRules)) {
      if (kindOf(rule) !== "style") continue
      const style = /** @type {CSSStyleRule} */ (rule)
      const value = style.style.getPropertyValue(property)
      if (value === "") continue
      found.push({ sheetId: id, path, selector: style.selectorText, value: value.trim(), priority: style.style.getPropertyPriority(property), rule: style })
    }
  }
  return found
}

/**
 * Up to `max` elements of the rendered part and its wrapper, spread through
 * its tree. The host itself is Caliper's, outside the app's shell.
 *
 * @param {Document} document
 * @param {number} max
 * @returns {Element[]}
 */
export function sample(document, max) {
  const all = [...document.querySelectorAll("#caliper-host *")]
  const step = Math.max(1, Math.ceil(all.length / max))
  return all.filter((_, index) => index % step === 0)
}

/**
 * Which declarations set `property` on the sampled elements, found by
 * knockout: a sentinel value in one declaration at a time, then read which
 * elements change. The browser runs the whole cascade, `@container` included.
 *
 * @param {Window} window the frame's window
 * @param {Element[]} elements
 * @param {string} property
 * @param {Candidate[]} candidates
 * @param {string} sentinel valid for the property's syntax
 * @returns {{ winners: Array<{ candidate: Candidate, elements: Element[] }>, unexplained: Element[] }}
 */
export function knockout(window, elements, property, candidates, sentinel) {
  const read = () => elements.map(element => window.getComputedStyle(element).getPropertyValue(property))
  const before = read()
  /** @type {Set<Element>} */
  const explained = new Set()
  /** @type {Array<{ candidate: Candidate, elements: Element[] }>} */
  const winners = []
  for (const candidate of candidates) {
    const style = candidate.rule.style
    const value = style.getPropertyValue(property)
    const priority = style.getPropertyPriority(property)
    style.setProperty(property, sentinel, priority)
    const after = read()
    style.setProperty(property, value, priority)
    const changed = elements.filter((_, index) => after[index] !== before[index])
    if (changed.length > 0) winners.push({ candidate, elements: changed })
    for (const element of changed) explained.add(element)
  }
  return { winners, unexplained: elements.filter(element => !explained.has(element)) }
}

/**
 * The custom properties that style rules declare and no `@property`
 * registers.
 *
 * @param {Document} document
 * @param {{ has: (name: string) => boolean }} registered
 * @returns {Set<string>}
 */
export function plainProperties(document, registered) {
  /** @type {Set<string>} */
  const found = new Set()
  for (const { sheet } of projectSheets(document)) {
    for (const { rule } of walk(sheet.cssRules)) {
      if (kindOf(rule) !== "style") continue
      for (const name of /** @type {CSSStyleRule} */ (rule).style) if (name.startsWith("--") && !registered.has(name)) found.add(name)
    }
  }
  return found
}

/**
 * Every declaration block that can name a custom property in a `var()`:
 * style rules, `@keyframes` frames, and the inline styles of the part.
 *
 * @param {Document} document
 * @returns {string[]}
 */
export function referenceBlocks(document) {
  /** @type {string[]} */
  const blocks = []
  for (const { sheet } of projectSheets(document)) {
    for (const { rule } of walk(sheet.cssRules)) {
      const kind = kindOf(rule)
      if (kind === "style") blocks.push(/** @type {CSSStyleRule} */ (rule).style.cssText)
      if (kind === "keyframes") for (const frame of /** @type {CSSKeyframesRule} */ (rule).cssRules) blocks.push(/** @type {CSSKeyframeRule} */ (frame).style.cssText)
    }
  }
  for (const element of document.querySelectorAll("#caliper-host [style], #caliper-host")) {
    const inline = element.getAttribute("style")
    if (inline) blocks.push(inline)
  }
  return blocks
}

/**
 * A shorthand's longhands, as the frame's browser expands them: a property
 * that is not a shorthand is its own.
 *
 * @param {Document} document
 * @returns {(property: string) => string[]}
 */
export function longhandsIn(document) {
  /** @type {Map<string, string[]>} */
  const cache = new Map()
  return property => {
    const known = cache.get(property)
    if (known) return known
    const probe = document.createElement("div")
    probe.style.setProperty(property, "inherit")
    const list = probe.style.length > 0 ? [...probe.style] : [property]
    cache.set(property, list)
    return list
  }
}

/**
 * Every element of the part, the host included, and each `::before` and
 * `::after` of theirs that renders. A plain property can be read on any of
 * them, so a sample is not enough.
 *
 * @param {Document} document
 * @returns {Array<{ element: Element, pseudo: string | null }>}
 */
export function readTargets(document) {
  const view = document.defaultView
  const host = document.getElementById("caliper-host")
  if (host === null || view === null) return []
  return [host, ...host.querySelectorAll("*")].flatMap(element => [null, "::before", "::after"]
    .filter(pseudo => pseudo === null || !/^(none|normal)$/.test(view.getComputedStyle(element, pseudo).content))
    .map(pseudo => ({ element, pseudo })))
}

/**
 * Whether the part reads a declaration: a sentinel in it changes one of the
 * longhands that name the property, on any target. Each sentinel is tried.
 *
 * @param {Window} window
 * @param {Array<{ element: Element, pseudo: string | null }>} targets
 * @param {Candidate} candidate
 * @param {string} property
 * @param {string[]} readers standard longhands
 * @param {string[]} sentinels
 */
export function isRead(window, targets, candidate, property, readers, sentinels) {
  if (readers.length === 0) return false
  const read = () => targets.map(({ element, pseudo }) => {
    const style = window.getComputedStyle(element, pseudo)
    return readers.map(name => style.getPropertyValue(name)).join("\u0000")
  })
  const style = candidate.rule.style
  const value = style.getPropertyValue(property)
  const priority = style.getPropertyPriority(property)
  const before = read()
  for (const sentinel of sentinels) {
    style.setProperty(property, sentinel, priority)
    const after = read()
    style.setProperty(property, value, priority)
    if (after.some((text, index) => text !== before[index])) return true
  }
  return false
}

/**
 * The registered initial value of `property`, as the browser computes it.
 *
 * @param {Document} document
 * @param {string} property
 */
export function initialComputed(document, property) {
  const probe = document.createElement("div")
  probe.style.setProperty(property, "initial")
  ;(document.getElementById("caliper-host") ?? document.body).append(probe)
  const value = (document.defaultView ?? window).getComputedStyle(probe).getPropertyValue(property)
  probe.remove()
  return value
}

/**
 * The `@container` rules that apply to the rendered part: a rule counts when
 * a style rule inside it matches an element in `#caliper-host`, whether the
 * condition holds now or not. States a selector names, such as `:hover`, and
 * pseudo-elements are left out of the match.
 *
 * @param {Document} document
 * @returns {ContainerSite[]}
 */
export function containersOf(document) {
  const host = document.getElementById("caliper-host")
  if (host === null) return []
  /** @type {ContainerSite[]} */
  const found = []
  for (const { id, sheet } of projectSheets(document)) {
    for (const { rule, path } of walk(sheet.cssRules)) {
      if (kindOf(rule) !== "container") continue
      const container = /** @type {CSSContainerRule} */ (rule)
      const used = [...walk(container.cssRules)].some(({ rule: inner }) => {
        if (kindOf(inner) !== "style") return false
        const selector = /** @type {CSSStyleRule} */ (inner).selectorText
          .replace(/::?(?:before|after|marker|placeholder|selection|backdrop|first-line|first-letter|file-selector-button)\b/gi, "")
          .replace(/:(?:hover|active|focus|focus-visible|focus-within|visited|target)\b/gi, "")
        try {
          return selector.trim() !== "" && (host.querySelector(selector) !== null || host.matches(selector))
        } catch {
          return false
        }
      })
      if (used) found.push({ sheetId: id, path, rule: container })
    }
  }
  return found
}

/**
 * A `@container` condition as the browser writes it, or null when the
 * browser cannot read it. It parses the rule in a sheet of its own.
 *
 * @param {Document} document
 * @param {string} condition
 */
export function readCondition(document, condition) {
  const View = /** @type {typeof CSSStyleSheet} */ (/** @type {any} */ (document.defaultView)?.CSSStyleSheet ?? CSSStyleSheet)
  const sheet = new View()
  try {
    sheet.replaceSync(`@container ${condition} {}`)
  } catch {
    return null
  }
  const rule = sheet.cssRules[0]
  return rule && kindOf(rule) === "container" ? /** @type {CSSContainerRule} */ (rule).conditionText : null
}

/** Rules a live edit inserted, so a later edit may replace them again. */
const inserted = new WeakSet()

/**
 * Show `value` for a site in the frame's live CSSOM, without writing a file.
 * An `@property` rule's initial value and a `@container` rule's condition are
 * read-only, so those rules are deleted and inserted again. False when the
 * rule is not where the site says.
 *
 * @param {Document} document
 * @param {Site} site
 * @param {string} value
 */
export function applyLive(document, site, value) {
  let applied = false
  for (const { id, sheet } of projectSheets(document)) {
    if (id !== site.sheetId) continue
    const rule = ruleAt(sheet, site.path)
    if (rule === null) continue
    if (site.property === "@container") {
      if (kindOf(rule) !== "container") continue
      const container = /** @type {CSSContainerRule} */ (rule)
      const wanted = readCondition(document, value)
      if (wanted === null) continue
      if (container.conditionText === wanted) {
        applied = true
        continue
      }
      // Vite reloaded the sheet with another condition: the file changed, and this is not the rule any more.
      if (container.conditionText !== site.selector && !inserted.has(container)) continue
      const parent = container.parentRule ?? container.parentStyleSheet
      const index = site.path.at(-1) ?? 0
      if (parent === null || !("insertRule" in parent)) continue
      const before = container.cssText
      parent.deleteRule(index)
      try {
        parent.insertRule(`@container ${value} ${before.slice(before.indexOf("{"))}`, index)
        inserted.add(/** @type {CSSRule} */ (parent.cssRules[index]))
        applied = true
      } catch {
        parent.insertRule(before, index)
      }
    } else if (site.property === "initial-value") {
      if (kindOf(rule) !== "property" || /** @type {CSSPropertyRule} */ (rule).name !== site.name) continue
      const property = /** @type {CSSPropertyRule} */ (rule)
      if (property.initialValue?.trim() === value) {
        applied = true
        continue
      }
      const parent = property.parentRule ?? property.parentStyleSheet
      const index = site.path.at(-1) ?? 0
      if (parent === null || !("insertRule" in parent)) continue
      const before = property.cssText
      const text = `@property ${property.name} { syntax: ${JSON.stringify(property.syntax)}; inherits: ${property.inherits}; initial-value: ${value}; }`
      parent.deleteRule(index)
      try {
        parent.insertRule(text, index)
        applied = true
      } catch {
        parent.insertRule(before, index)
      }
    } else {
      if (kindOf(rule) !== "style" || /** @type {CSSStyleRule} */ (rule).selectorText !== site.selector) continue
      const style = /** @type {CSSStyleRule} */ (rule).style
      if (style.getPropertyValue(site.property) === "") continue
      style.setProperty(site.property, value, style.getPropertyPriority(site.property))
      applied = true
    }
  }
  return applied
}

/**
 * Tell `changed` when Vite replaces a stylesheet's text in the frame, or adds
 * one. Vite keeps the `<style>` element and sets its text, so every live edit
 * in it is gone and must be put back.
 *
 * @param {Document} document
 * @param {() => void} changed
 * @returns {() => void} stop
 */
export function observeSheets(document, changed) {
  const View = /** @type {typeof MutationObserver} */ (/** @type {any} */ (document.defaultView)?.MutationObserver ?? MutationObserver)
  const observer = new View(records => {
    if (records.some(record => isSheet(record.target) || isSheet(record.target.parentNode) || [...record.addedNodes].some(isSheet))) changed()
  })
  observer.observe(document.head, { childList: true, characterData: true, subtree: true })
  return () => observer.disconnect()
}

/** @param {Node | null} node */
function isSheet(node) {
  return node !== null && node.nodeType === 1 && /** @type {Element} */ (node).hasAttribute("data-vite-dev-id")
}
