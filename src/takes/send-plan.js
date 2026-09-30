// @ts-check
/**
 * Send policy. Pure, browser-safe, and not a wire validator.
 * Callers supply validated take identities, current mark locations and notes.
 * Server and chrome must both re-evaluate this plan before Send.
 *
 * Phase 6 (plan decisions 6 to 8): a note can name a mark on another take
 * ("use 2A here") or on the original ("restore 0A"). A marked take, or the
 * original, gets a new take only when at least one of its marks is named by
 * no note on another take. Its other marks go to that new take too. A take
 * whose marks are all named makes no take; its marks go, as reference
 * material, to the takes whose notes name them.
 *
 * @typedef {{ readonly take: string, readonly created: number }} TakeIdentity
 * @typedef {{ readonly _tag: "Located" } | { readonly _tag: "Lost" | "Unresolved", readonly reason: string }} MarkLocation
 * A mark's `name` is its display name, the take number and letter ("3A", "0A"
 * on the original). Reasons and notes use it; the opaque `id` never reaches the user.
 * @typedef {{ readonly id: string, readonly name: string, readonly note: string, readonly source: TakeIdentity, readonly location: MarkLocation }} SendMark
 * @typedef {TakeIdentity & { readonly kind: "Experiment" | "Alternate", readonly run: import('../types').TakeRun }} SendTake
 * @typedef {{ readonly _tag: "NewTake" } | { readonly _tag: "PointedTo" }} SendOutcome
 *   `NewTake`: Send makes one new take from this source. `PointedTo`: every mark
 *   is named by a note on another take, so it makes none.
 * @typedef {{
 *   readonly source: TakeIdentity, readonly marks: readonly string[], readonly reasons: readonly string[],
 *   readonly outcome: SendOutcome, readonly pointsTo: readonly string[]
 * }} SendGroup
 *   `pointsTo`: ids of marks on other sources that this group's notes name, in draft order.
 * @typedef {{ readonly markCount: number, readonly takeCount: number, readonly label: string, readonly groups: readonly SendGroup[] }} SendCounts
 * @typedef {SendCounts & ({ readonly _tag: "Empty" } | { readonly _tag: "Ready" } | { readonly _tag: "Blocked", readonly reasons: readonly string[] })} SendPlan
 */

/** The original (the real files) as a mark source. Its marks are named "0A", "0B" and so on. */
export const ORIGINAL = Object.freeze({ take: "0", created: 0 })

/** @param {TakeIdentity} source */
export const isOriginal = source => source.take === ORIGINAL.take && source.created === ORIGINAL.created

/** A mark name in a note: a take number (0 for the original) and capital letters, as a whole word. */
const NAME = /(?<![\w])(0|[1-9]\d*)([A-Z]{1,3})(?![\w])/g

/**
 * The mark names a note on take `own` points to: names of marks that exist,
 * on another take or the original, each once, in the order written.
 * @param {string} note @param {string} own the take number the note's mark is on @param {readonly string[]} names every mark name in the draft
 * @returns {string[]}
 */
export function referencesIn(note, own, names) {
  const known = new Set(names)
  /** @type {string[]} */
  const found = []
  for (const match of note.matchAll(NAME)) {
    const name = match[0]
    if (match[1] !== own && known.has(name) && !found.includes(name)) found.push(name)
  }
  return found
}

/**
 * @param {TakeIdentity} source @param {readonly SendTake[]} takes
 * @returns {string | null} why marks on this source cannot be sent
 */
function sourceProblem(source, takes) {
  if (isOriginal(source)) return null
  const parent = takes.find(take => take.take === source.take && take.created === source.created)
  if (!parent) return `Take ${source.take} is no longer available at its marked creation identity.`
  if (parent.kind === "Alternate") return `Take ${parent.take} is an alternate and cannot receive marks.`
  if (parent.run._tag === "Running") return `Take ${parent.take} is still running. Stop its agent or wait.`
  return null
}

/**
 * Group in draft order. A blocked result authorizes no takes, including ready groups.
 * Missing parents, reused ids and unresolved locations block instead of dropping marks.
 * @param {readonly SendMark[]} marks
 * @param {readonly SendTake[]} takes
 * @returns {SendPlan}
 */
export function planSend(marks, takes) {
  /** @type {Map<string, { source: TakeIdentity, marks: string[], reasons: string[], pointsTo: string[] }>} */
  const grouped = new Map()
  const ids = new Set()
  const byName = new Map(marks.map(mark => [mark.name, mark.id]))
  const names = [...byName.keys()]
  /** @type {Set<string>} */
  const named = new Set()
  for (const mark of marks) {
    const key = JSON.stringify([mark.source.take, mark.source.created])
    let group = grouped.get(key)
    if (!group) {
      const problem = sourceProblem(mark.source, takes)
      group = { source: { ...mark.source }, marks: [], reasons: problem ? [problem] : [], pointsTo: [] }
      grouped.set(key, group)
    }
    if (ids.has(mark.id)) group.reasons.push(`Mark ${mark.name} appears more than once in the draft.`)
    ids.add(mark.id)
    group.marks.push(mark.id)
    if (mark.location._tag !== "Located") group.reasons.push(`${mark.name}: ${mark.location.reason}`)
    for (const name of referencesIn(mark.note, mark.source.take, names)) {
      const id = /** @type {string} */ (byName.get(name))
      named.add(id)
      if (!group.pointsTo.includes(id)) group.pointsTo.push(id)
    }
  }
  const groups = [...grouped.values()].map(group => ({
    ...group,
    outcome: /** @type {SendOutcome} */ (group.marks.some(id => !named.has(id)) ? { _tag: "NewTake" } : { _tag: "PointedTo" }),
  }))
  const takeCount = groups.filter(group => group.outcome._tag === "NewTake").length
  const reasons = groups.flatMap(group => group.reasons)
  if (marks.length && !takeCount) reasons.push("Every mark is pointed to by another note, so Send makes no take. Add a mark that no note points to.")
  const counts = { markCount: marks.length, takeCount, label: `Send · ${takeCount} new ${takeCount === 1 ? "take" : "takes"}`, groups }
  if (!marks.length) return { ...counts, _tag: "Empty" }
  if (reasons.length) return { ...counts, _tag: "Blocked", reasons }
  return { ...counts, _tag: "Ready" }
}
