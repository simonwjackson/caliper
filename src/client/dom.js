// @ts-check

/**
 * Make an element. A function prop such as `onClick` becomes an event
 * listener, `true` an empty attribute, and `false` no attribute.
 *
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, string | boolean | ((event: Event) => void)>} [props]
 * @param {Array<Node | string | null | false>} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === "function") element.addEventListener(key.slice(2).toLowerCase(), value)
    else if (value === true) element.setAttribute(key, "")
    else if (value !== false) element.setAttribute(key, value)
  }
  for (const child of children) if (child !== null && child !== false) element.append(child)
  return element
}
