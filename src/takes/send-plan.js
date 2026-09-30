// @ts-check
/**
 * Phase 4 Send policy. Pure, browser-safe, and not a wire validator.
 * Callers supply validated take identities and current mark locations.
 * Server and chrome must both re-evaluate this plan before Send.
 * References and marks on the original belong to phase 6.
 *
 * @typedef {{ readonly take: string, readonly created: number }} TakeIdentity
 * @typedef {{ readonly _tag: "Located" } | { readonly _tag: "Lost" | "Unresolved", readonly reason: string }} MarkLocation
 * A mark's `name` is its display name, the take number and letter ("3A").
 * Reasons use it; the opaque `id` never reaches the user.
 * @typedef {{ readonly id: string, readonly name: string, readonly source: TakeIdentity, readonly location: MarkLocation }} SendMark
 * @typedef {TakeIdentity & { readonly kind: "Experiment" | "Alternate", readonly run: import('../types').TakeRun }} SendTake
 * @typedef {{ readonly source: TakeIdentity, readonly marks: readonly string[], readonly reasons: readonly string[] }} SendGroup
 * @typedef {{ readonly markCount: number, readonly takeCount: number, readonly label: string, readonly groups: readonly SendGroup[] }} SendCounts
 * @typedef {SendCounts & ({ readonly _tag: "Empty" } | { readonly _tag: "Ready" } | { readonly _tag: "Blocked", readonly reasons: readonly string[] })} SendPlan
 */

/**
 * Group in draft order. A blocked result authorizes no takes, including ready groups.
 * Missing parents, reused ids and unresolved locations block instead of dropping marks.
 * @param {readonly SendMark[]} marks
 * @param {readonly SendTake[]} takes
 * @returns {SendPlan}
 */
export function planSend(marks, takes) {
  /** @type {Map<string, { source: TakeIdentity, marks: string[], reasons: string[] }>} */
  const grouped = new Map()
  const ids = new Set()
  for (const mark of marks) {
    const key = JSON.stringify([mark.source.take, mark.source.created])
    let group = grouped.get(key)
    if (!group) {
      group = { source: { ...mark.source }, marks: [], reasons: [] }
      grouped.set(key, group)
      const parent = takes.find(take => take.take === mark.source.take && take.created === mark.source.created)
      if (!parent) group.reasons.push(`Take ${mark.source.take} is no longer available at its marked creation identity.`)
      else if (parent.kind === "Alternate") group.reasons.push(`Take ${parent.take} is an alternate and cannot receive marks.`)
      else if (parent.run._tag === "Running") group.reasons.push(`Take ${parent.take} is still running. Stop its agent or wait.`)
    }
    if (ids.has(mark.id)) group.reasons.push(`Mark ${mark.name} appears more than once in the draft.`)
    ids.add(mark.id)
    group.marks.push(mark.id)
    if (mark.location._tag !== "Located") group.reasons.push(`${mark.name}: ${mark.location.reason}`)
  }
  const groups = [...grouped.values()]
  const reasons = groups.flatMap(group => group.reasons)
  const takeCount = groups.length
  const counts = { markCount: marks.length, takeCount, label: `Send · ${takeCount} new ${takeCount === 1 ? "take" : "takes"}`, groups }
  if (!marks.length) return { ...counts, _tag: "Empty" }
  if (reasons.length) return { ...counts, _tag: "Blocked", reasons }
  return { ...counts, _tag: "Ready" }
}
