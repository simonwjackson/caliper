// @ts-check

/**
 * Product-declared relationships between executable states. This graph is
 * navigation data, never a recipe for substituting a child at runtime.
 *
 * @typedef {import("../types").Part} Part
 * @typedef {import("../types").StateRef} StateRef
 */

/** @param {unknown} value @returns {value is StateRef} */
function isStateRef(value) {
  return typeof value === "object" && value !== null
    && "part" in value && typeof value.part === "string"
    && "state" in value && typeof value.state === "string"
}

/** @param {StateRef} left @param {StateRef} right */
export function sameState(left, right) {
  return isStateRef(left) && isStateRef(right) && left.part === right.part && left.state === right.state
}

/** @param {readonly Part[]} parts @param {StateRef} ref */
export function stateExists(parts, ref) {
  return isStateRef(ref) && parts.some(part => part.file === ref.part && part.states.some(state => state.export === ref.state))
}

/** @param {StateRef} ref */
const key = ref => JSON.stringify([ref.part, ref.state])

/**
 * All declared descendants, in breadth-first declaration order. Missing
 * references are skipped; a stale or cyclic graph cannot trap the chrome.
 *
 * @param {readonly Part[]} parts
 * @param {StateRef} context
 * @returns {StateRef[]}
 */
export function subjectsOf(parts, context) {
  if (!stateExists(parts, context)) return []
  const seen = new Set([key(context)])
  const queue = [context]
  /** @type {StateRef[]} */
  const subjects = []
  for (let index = 0; index < queue.length; index += 1) {
    const ref = queue[index]
    const part = parts.find(part => part.file === ref.part)
    const children = part?.composition?.[ref.state]
    if (!Array.isArray(children)) continue
    for (const child of children) {
      if (!stateExists(parts, child) || seen.has(key(child))) continue
      seen.add(key(child))
      const subject = { part: child.part, state: child.state }
      subjects.push(subject)
      queue.push(subject)
    }
  }
  return subjects
}

/**
 * Every declared parent scenario, including transitive parents, in catalog
 * order. A state's own isolated preview is not a context.
 *
 * @param {readonly Part[]} parts
 * @param {StateRef} subject
 * @returns {StateRef[]}
 */
export function contextsFor(parts, subject) {
  if (!stateExists(parts, subject)) return []
  const seen = new Set()
  return parts.flatMap(part => part.states.flatMap(state => {
    const context = { part: part.file, state: state.export }
    if (seen.has(key(context)) || sameState(context, subject)) return []
    seen.add(key(context))
    return subjectsOf(parts, context).some(child => sameState(child, subject)) ? [context] : []
  }))
}

/**
 * The editing subject's other states and all their declared contexts. This
 * is declared coverage, not a claim to find every consumer of edited code.
 *
 * @param {readonly Part[]} parts
 * @param {StateRef} subject
 * @returns {StateRef[]}
 */
export function relatedStates(parts, subject) {
  if (!stateExists(parts, subject)) return []
  const part = parts.find(part => part.file === subject.part)
  const states = part?.states.map(state => ({ part: part.file, state: state.export })) ?? []
  const seen = new Set(states.map(key))
  const related = [...states]
  for (const state of states) {
    for (const context of contextsFor(parts, state)) {
      if (seen.has(key(context))) continue
      seen.add(key(context))
      related.push(context)
    }
  }
  return related
}
