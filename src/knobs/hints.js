// @ts-check

/**
 * Knob hints: what standard CSS cannot say about a design input. A hint is a
 * doc comment directly above the declaration (decision 26):
 *
 *   /** @label Pixel rows @min 180 @max 720 @step 10 *\/
 *   /** @knob ignore *\/
 *
 * Only a doc comment (`/**`) holds hints, so prose in an ordinary comment that
 * mentions `@media` is never read as one. The browser drops comments from the
 * CSSOM, so Caliper reads hints from the source text.
 *
 * @typedef {import("../types").KnobHints} KnobHints
 * @typedef {{ hints: KnobHints, note: string, problems: string[] }} ParsedComment
 */

const KNOWN = "It reads @label, @min, @max, @step and @knob ignore."
const TAG = /(^|\s)@([a-z][\w-]*)/gi

/**
 * @param {string} text the comment's text, without its opening and closing marks
 * @param {boolean} doc whether it opened with `/**`
 * @returns {ParsedComment}
 */
export function parseComment(text, doc) {
  const plain = text.split("\n").map(line => line.replace(/^\s*\*?\s?/, "")).join(" ").replace(/\s+/g, " ").trim()
  if (!doc) return { hints: {}, note: plain, problems: [] }
  /** @type {{ -readonly [K in keyof KnobHints]: KnobHints[K] }} */
  const hints = {}
  /** @type {string[]} */
  const problems = []
  const tags = [...plain.matchAll(TAG)]
  const note = (tags.length === 0 ? plain : plain.slice(0, tags[0]?.index ?? 0)).trim()
  tags.forEach((match, index) => {
    const name = match[2] ?? ""
    const from = (match.index ?? 0) + match[0].length
    const value = plain.slice(from, tags[index + 1]?.index ?? plain.length).trim()
    if (name === "label") {
      if (value === "") problems.push("@label needs a name after it.")
      else hints.label = value
    } else if (name === "min" || name === "max" || name === "step") {
      const number = Number(value)
      if (value === "" || !Number.isFinite(number)) problems.push(`@${name} needs a number, not "${value}".`)
      else if (name === "step" && number <= 0) problems.push("@step must be more than 0.")
      else hints[name] = number
    } else if (name === "knob") {
      if (value === "ignore") hints.ignore = true
      else problems.push(`@knob takes only "ignore", not "${value}".`)
    } else {
      problems.push(`Caliper does not know the hint @${name}. ${KNOWN}`)
    }
  })
  if (hints.min !== undefined && hints.max !== undefined && hints.min > hints.max) {
    problems.push(`@min ${hints.min} is more than @max ${hints.max}.`)
    delete hints.min
    delete hints.max
  }
  return { hints, note, problems }
}
