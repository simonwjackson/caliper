// @ts-check
/**
 * Where a mark sits in a frame's document, and how to find it again.
 *
 * Browser code. The chrome runs `anchorAt` and `anchorIn` in a frame it
 * shows; the chrome and the headless render run `locateAnchor` and
 * `drawMarks`. Playwright sends a function's source text to the page, so
 * `locateAnchor` and `drawMarks` must not use anything outside themselves.
 *
 * Coordinates: gestures arrive in the frame's viewport CSS px. Anchors store
 * document-origin CSS px, so a mark stays put when the frame scrolls.
 *
 * @typedef {import("./marks-contract.js").MarkAnchor} MarkAnchor
 * @typedef {import("./marks-contract.js").MarkElement} MarkElement
 * @typedef {import("./marks-contract.js").StoredRect} StoredRect
 * @typedef {{ _tag: "Located", rect: StoredRect } | { _tag: "Lost", reason: string, rect: StoredRect }} AnchorLocation
 *   `rect` is document-origin. A lost mark keeps its last known rect.
 */

/** Attributes that name an element for tests. Stable across edits that add siblings. */
const TEST_ATTRIBUTES = ["data-testid", "data-test", "data-cy", "data-caliper"]
const HOST = "caliper-host"
const TEXT = 80
const REGION_ELEMENTS = 12

/**
 * The anchor of a click at `point`: the element under it.
 *
 * @param {Document} document the frame's document
 * @param {{ x: number, y: number }} point viewport CSS px
 * @param {boolean} afterInput
 * @returns {{ _tag: "Anchored", anchor: MarkAnchor } | { _tag: "Refused", reason: string }}
 */
export function anchorAt(document, point, afterInput) {
  const host = document.getElementById(HOST)
  if (!host) return { _tag: "Refused", reason: "This frame has no rendered part to mark." }
  const scroll = scrollOf(document)
  const target = within(host, document.elementFromPoint(point.x, point.y))
  return {
    _tag: "Anchored",
    anchor: { kind: "Point", rect: { x: point.x + scroll.x, y: point.y + scroll.y, width: 0, height: 0 }, element: describe(document, host, target), elements: [], afterInput },
  }
}

/**
 * The anchor of a drag over `rect`: the smallest element that holds all of
 * it, and the outermost elements inside it.
 *
 * @param {Document} document
 * @param {StoredRect} rect viewport CSS px
 * @param {boolean} afterInput
 * @returns {{ _tag: "Anchored", anchor: MarkAnchor } | { _tag: "Refused", reason: string }}
 */
export function anchorIn(document, rect, afterInput) {
  const host = document.getElementById(HOST)
  if (!host) return { _tag: "Refused", reason: "This frame has no rendered part to mark." }
  const scroll = scrollOf(document)
  const holds = (/** @type {DOMRect} */ box) => box.left <= rect.x + 1 && box.top <= rect.y + 1 && box.right >= rect.x + rect.width - 1 && box.bottom >= rect.y + rect.height - 1
  let container = within(host, document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
  while (container !== host && !holds(container.getBoundingClientRect())) container = /** @type {Element} */ (container.parentElement)
  /** @type {Element[]} */
  const inside = []
  for (const element of host.querySelectorAll("*")) {
    if (inside.length >= REGION_ELEMENTS) break
    const box = element.getBoundingClientRect()
    if (box.width === 0 && box.height === 0) continue
    const contained = box.left >= rect.x - 1 && box.top >= rect.y - 1 && box.right <= rect.x + rect.width + 1 && box.bottom <= rect.y + rect.height + 1
    if (contained && !inside.some(outer => outer.contains(element))) inside.push(element)
  }
  return {
    _tag: "Anchored",
    anchor: {
      kind: "Region",
      rect: { x: rect.x + scroll.x, y: rect.y + scroll.y, width: rect.width, height: rect.height },
      element: describe(document, host, container),
      elements: inside.map(element => describe(document, host, element)),
      afterInput,
    },
  }
}

/**
 * Find a stored anchor in a document. A mark is lost when its selector
 * matches nothing, matches an element with no box, or the element's text no
 * longer starts with the stored text. A located mark moves with its element.
 *
 * Self-contained: the headless render sends this function's source to the page.
 *
 * @param {Document} document
 * @param {MarkAnchor} anchor
 * @returns {AnchorLocation}
 */
export function locateAnchor(document, anchor) {
  const lost = (/** @type {string} */ reason) => /** @type {AnchorLocation} */ ({ _tag: "Lost", reason, rect: anchor.rect })
  /** @type {Element | null} */
  let element
  try { element = document.querySelector(anchor.element.selector) }
  catch { return lost("The mark's element cannot be looked up.") }
  if (element === null) return lost("Element not found.")
  const box = element.getBoundingClientRect()
  if (box.width === 0 && box.height === 0) return lost("The element has no size now.")
  const text = (element.textContent ?? "").replace(/\s+/g, " ").trim()
  if (!text.startsWith(anchor.element.text)) return lost("The element's text changed.")
  const view = document.defaultView
  const left = box.left + (view?.scrollX ?? 0), top = box.top + (view?.scrollY ?? 0)
  const dx = left - anchor.element.box.x, dy = top - anchor.element.box.y
  if (anchor.kind === "Region") return { _tag: "Located", rect: { ...anchor.rect, x: anchor.rect.x + dx, y: anchor.rect.y + dy } }
  // A point keeps its place in its element, inside the element's current box.
  const x = Math.min(Math.max(anchor.rect.x + dx, left), left + box.width)
  const y = Math.min(Math.max(anchor.rect.y + dy, top), top + box.height)
  return { _tag: "Located", rect: { x, y, width: 0, height: 0 } }
}

/**
 * Draw pins and regions over the page, for the picture the agent gets.
 * Two tones, so a pin shows on light and dark parts. Rects are document-origin.
 *
 * Self-contained: the headless render sends this function's source to the page.
 *
 * @param {Document} document
 * @param {ReadonlyArray<{ letter: string, kind: "Point" | "Region", rect: StoredRect }>} marks
 */
export function drawMarks(document, marks) {
  const layer = document.createElement("div")
  layer.setAttribute("data-caliper-marks", "")
  layer.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;font:700 13px/1 system-ui,sans-serif"
  const label = (/** @type {string} */ letter) => {
    const tag = document.createElement("span")
    tag.textContent = letter
    tag.style.cssText = "position:absolute;display:flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 4px;box-sizing:border-box;background:#fff;color:#000;border:2px solid #000;box-shadow:0 0 0 1px #fff"
    return tag
  }
  for (const mark of marks) {
    if (mark.kind === "Region") {
      const box = document.createElement("div")
      box.style.cssText = `position:absolute;left:${mark.rect.x}px;top:${mark.rect.y}px;width:${mark.rect.width}px;height:${mark.rect.height}px;box-sizing:border-box;border:2px solid #000;outline:2px solid #fff;background:rgba(255,255,255,.14)`
      const tag = label(mark.letter)
      tag.style.left = "-2px"
      tag.style.top = "-22px"
      box.append(tag)
      layer.append(box)
    } else {
      const dot = document.createElement("div")
      dot.style.cssText = `position:absolute;left:${mark.rect.x - 4}px;top:${mark.rect.y - 4}px;width:8px;height:8px;border-radius:50%;background:#000;box-shadow:0 0 0 2px #fff`
      const tag = label(mark.letter)
      tag.style.borderRadius = "10px 10px 10px 0"
      tag.style.left = `${mark.rect.x + 2}px`
      tag.style.top = `${mark.rect.y - 24}px`
      layer.append(dot, tag)
    }
  }
  document.documentElement.append(layer)
}

/** @param {Document} document */
function scrollOf(document) {
  return { x: document.defaultView?.scrollX ?? 0, y: document.defaultView?.scrollY ?? 0 }
}

/** A click outside the part (on the page around it) attaches to the part's host. @param {Element} host @param {Element | null} element */
function within(host, element) {
  return element !== null && host.contains(element) ? element : host
}

/**
 * @param {Document} document
 * @param {Element} host
 * @param {Element} element
 * @returns {MarkElement}
 */
function describe(document, host, element) {
  const box = element.getBoundingClientRect()
  const scroll = scrollOf(document)
  return {
    selector: selectorOf(document, host, element),
    tag: element.tagName.toLowerCase(),
    classes: [...element.classList].slice(0, 20).map(name => name.slice(0, 200)),
    text: (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, TEXT),
    box: { x: box.left + scroll.x, y: box.top + scroll.y, width: box.width, height: box.height },
  }
}

/**
 * A selector from the part's host down to the element. A unique id or test
 * attribute ends the walk early; otherwise each step is `tag:nth-of-type(n)`.
 * Cost: an edit that adds a sibling above an unnamed element can move the
 * mark to another element; the text check catches most such moves.
 *
 * @param {Document} document
 * @param {Element} host
 * @param {Element} element
 */
export function selectorOf(document, host, element) {
  /** @type {string[]} */
  const steps = []
  let node = element
  while (node !== host) {
    const tag = node.tagName.toLowerCase()
    if (node.id && document.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) {
      steps.unshift(`#${CSS.escape(node.id)}`)
      return `#${HOST} ${steps.join(" > ")}`
    }
    const attribute = TEST_ATTRIBUTES.find(name => node.hasAttribute(name))
    if (attribute) {
      const step = `${tag}[${attribute}=${JSON.stringify(node.getAttribute(attribute))}]`
      if (host.querySelectorAll(step).length === 1) {
        steps.unshift(step)
        return `#${HOST} ${steps.join(" > ")}`
      }
    }
    const parent = /** @type {Element} */ (node.parentElement)
    const same = [...parent.children].filter(child => child.tagName === node.tagName)
    steps.unshift(`${tag}:nth-of-type(${same.indexOf(node) + 1})`)
    node = parent
  }
  return steps.length ? `#${HOST} > ${steps.join(" > ")}` : `#${HOST}`
}
