// @ts-check
/**
 * Phase 5 chain policy. Pure and browser-safe; not a wire validator.
 * Callers supply the takes that exist now, with the chain fields of their
 * records, and the accept log. Take identity is number plus creation time,
 * because take numbers are reused after a discard.
 *
 * Plan decisions 11 to 13 and planner choice 15 (answered C on 2026-09-30):
 * a take is flagged when an accept after it was made touched the same part or
 * any of its files.
 *
 * @typedef {{ readonly take: string, readonly created: number }} TakeIdentity
 * @typedef {TakeIdentity & {
 *   readonly part: string, readonly state: string, readonly files: readonly string[],
 *   readonly chain?: TakeIdentity, readonly lineage?: readonly TakeIdentity[]
 * }} ChainTake
 *   `chain` is the chain's first take and `lineage` runs from it to the parent,
 *   both copied from the take's record. A take made from a prompt has neither.
 * @typedef {TakeIdentity & { readonly part: string, readonly state: string, readonly files: readonly string[], readonly at: number }} AcceptRecord
 *   One line of `.caliper/accepted.json`: the accepted take, what it wrote, and when.
 * @typedef {TakeIdentity & { readonly present: boolean }} ChainStep
 * @typedef {{
 *   readonly id: string, readonly root: TakeIdentity, readonly members: readonly TakeIdentity[],
 *   readonly head: TakeIdentity, readonly shown: TakeIdentity, readonly parent: TakeIdentity | null,
 *   readonly discarded: number, readonly steps: readonly ChainStep[]
 * }} Chain
 *   `head` is the newest take. `shown` is the take in the pair: the selected take
 *   when it is in this chain, otherwise the head. `parent` is the nearest
 *   ancestor of `shown` that still exists; `discarded` counts the ancestors
 *   between them (or before `shown`, when none exists). `steps` is every take
 *   the chain has had, oldest first, present or discarded.
 * @typedef {{ readonly _tag: "Current" }
 *   | { readonly _tag: "Before", readonly take: string, readonly reason: "Part" }
 *   | { readonly _tag: "Before", readonly take: string, readonly reason: "Files" | "PartAndFiles", readonly files: readonly string[] }} AcceptFlag
 */

/** @param {TakeIdentity} identity */
export const identityKey = identity => `${identity.take}@${identity.created}`
/** @param {TakeIdentity} a @param {TakeIdentity} b */
const same = (a, b) => a.take === b.take && a.created === b.created
/** @param {TakeIdentity} identity */
const plain = identity => ({ take: identity.take, created: identity.created })

/** The chain's first take, or the take itself. @param {ChainTake} take @returns {TakeIdentity} */
export function chainOf(take) {
  return plain(take.chain ?? take)
}

/**
 * Group takes into chains, in the order the chains began.
 * @param {readonly ChainTake[]} takes
 * @param {TakeIdentity | null} selected
 * @returns {Chain[]}
 */
export function planChains(takes, selected) {
  /** @type {Map<string, ChainTake[]>} */
  const grouped = new Map()
  for (const take of [...takes].sort((a, b) => a.created - b.created)) {
    const key = identityKey(chainOf(take))
    grouped.set(key, [...(grouped.get(key) ?? []), take])
  }
  const exists = (/** @type {TakeIdentity} */ identity) => takes.some(take => same(take, identity))
  return [...grouped.entries()]
    .map(([id, members]) => {
      const root = chainOf(/** @type {ChainTake} */ (members[0]))
      const head = /** @type {ChainTake} */ (members[members.length - 1])
      const shown = (selected && members.find(take => same(take, selected))) || head
      const lineage = shown.lineage ?? []
      let at = lineage.length - 1
      while (at >= 0 && !exists(/** @type {TakeIdentity} */ (lineage[at]))) at -= 1
      /** @type {Map<string, ChainStep>} */
      const steps = new Map()
      for (const take of members) {
        for (const ancestor of take.lineage ?? []) if (!steps.has(identityKey(ancestor))) steps.set(identityKey(ancestor), { ...plain(ancestor), present: exists(ancestor) })
        steps.set(identityKey(take), { ...plain(take), present: true })
      }
      return {
        id, root, members: members.map(plain), head: plain(head), shown: plain(shown),
        parent: at >= 0 ? plain(/** @type {TakeIdentity} */ (lineage[at])) : null,
        discarded: lineage.length - 1 - at,
        steps: [...steps.values()].sort((a, b) => a.created - b.created),
      }
    })
    .sort((a, b) => a.root.created - b.root.created)
}

/**
 * The pair's heading, for example "7 ← from 3 (5 discarded)". One wording for
 * the canvas, the take record and the fixtures.
 * @param {Pick<Chain, "shown" | "parent" | "discarded">} chain
 */
export function lineageLabel(chain) {
  const gap = chain.discarded ? ` (${chain.discarded} discarded${chain.parent ? "" : " before it"})` : ""
  return `${chain.shown.take}${chain.parent ? ` ← from ${chain.parent.take}` : ""}${gap}`
}

/** @param {number} steps */
export const historyLabel = steps => `${steps} in chain`

/** @param {readonly string[]} takes */
const takeList = takes => takes.length === 1 ? `take ${takes[0]}` : `takes ${takes.slice(0, -1).join(", ")} and ${takes[takes.length - 1]}`

/**
 * What Accept also removes (plan decision 12), or "" when the take is alone.
 * @param {Pick<Chain, "members">} chain @param {TakeIdentity} take
 */
export function acceptNote(chain, take) {
  const others = chain.members.filter(member => !same(member, take)).map(member => member.take)
  return others.length ? `Accept also removes ${takeList(others)} of this chain.` : ""
}

/**
 * The flag's words for the canvas and the take record.
 * @param {AcceptFlag} flag
 * @returns {{ readonly label: string, readonly detail: string } | null}
 */
export function flagWords(flag) {
  if (flag._tag === "Current") return null
  const label = `made before take ${flag.take} was accepted`
  const what = flag.reason === "Part" ? "this part" : `${flag.files.join(", ")}${flag.reason === "PartAndFiles" ? " in this part" : ""}`
  return { label, detail: `Take ${flag.take} changed ${what} after this take was made. Accepting this take can undo that.` }
}

/**
 * Whether an accept made after this take could be undone by accepting it.
 * The newest accept that touched the same part or one of the take's files
 * names the flag. The flag warns; it never blocks.
 * @param {ChainTake} take
 * @param {readonly AcceptRecord[]} accepted
 * @returns {AcceptFlag}
 */
export function acceptFlag(take, accepted) {
  const later = accepted.filter(record => record.at > take.created && !same(record, take)).sort((a, b) => b.at - a.at)
  for (const record of later) {
    const files = take.files.filter(file => record.files.includes(file))
    const part = record.part === take.part
    if (part && files.length) return { _tag: "Before", take: record.take, reason: "PartAndFiles", files }
    if (part) return { _tag: "Before", take: record.take, reason: "Part" }
    if (files.length) return { _tag: "Before", take: record.take, reason: "Files", files }
  }
  return { _tag: "Current" }
}
