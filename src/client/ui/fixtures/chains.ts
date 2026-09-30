/**
 * Local chains for the gallery and the part files (decision 18): the take
 * records that exist, each with the lineage its record keeps, and the accept
 * log, turned into the canvas's chains by the shared chain policy, as core's
 * view does. It is not core. It stores nothing and reads no server; the
 * records are explicit inputs. What you picked, unfolded or swapped is read
 * back from the view, so a scenario can change one choice and rebuild.
 */
import type { AcceptFlag, ChainStepView, ChainView, ChromeView, FrameView, TakeSummary } from "../contract"
import { acceptFlag, flagWords, historyLabel, lineageLabel, planChains } from "../../../takes/chains.js"
import type { AcceptFlag as PolicyFlag, AcceptRecord, ChainTake, TakeIdentity } from "../../../takes/chains.js"
import { frameIdentity } from "./markup"

/**
 * One project's takes: the records that exist now, the accept log, and the
 * frame a take gets when the canvas starts to show it.
 */
export type ChainFamily = {
  readonly takes: readonly ChainTake[]
  readonly accepted: readonly AcceptRecord[]
  readonly frame: (take: ChainTake) => FrameView
}
/** What you chose: the selected take, the chains whose history is open, and the side each pair shows when it does not fit. */
export type ChainChoices = {
  readonly selected: TakeIdentity | null
  readonly open: readonly string[]
  readonly solo: Readonly<Record<string, "Shown" | "Parent">>
}

const same = (a: TakeIdentity, b: TakeIdentity | null) => !!b && a.take === b.take && a.created === b.created
/** A take's frame key, as the fixtures write it: its number and the minute it was made, the form `frameIdentity` reads back. */
export const takeKey = (identity: TakeIdentity) => `${identity.take}@${new Date(identity.created).toISOString().slice(0, 16)}`

/** The policy's flag in the contract's words. */
export function flagView(flag: PolicyFlag): AcceptFlag {
  const words = flagWords(flag)
  return flag._tag === "Before" && words ? { _tag: "Before", take: flag.take, ...words } : { _tag: "Current" }
}

/** A take's heading and flag for its summary: "" for a take with no ancestors, as core writes it. */
export function chainFacts(family: ChainFamily, identity: TakeIdentity): Pick<TakeSummary, "lineage" | "flag"> {
  const take = family.takes.find(item => same(item, identity))
  const chain = planChains(family.takes, identity).find(item => same(item.shown, identity))
  return {
    lineage: chain && (chain.parent || chain.discarded) ? lineageLabel(chain) : "",
    flag: take ? flagView(acceptFlag(take, family.accepted)) : { _tag: "Current" },
  }
}

/**
 * Put the family's chains on a Takes canvas: the loose frames first (the real
 * files), then for each chain its parent and its shown take. A frame the view
 * already has is kept, with its marks and run; a take the canvas starts to
 * show gets the family's frame. History steps say "Take 4, discarded".
 */
export function withChains(view: ChromeView, family: ChainFamily, choices: ChainChoices): ChromeView {
  if (view.canvas._tag !== "Frames") return view
  const old = new Map(view.canvas.frames.map(frame => [frame.key, frame]))
  const frames: FrameView[] = view.canvas.frames.filter(frame => !frame.take)
  const record = (identity: TakeIdentity) => family.takes.find(take => same(take, identity))
  const add = (identity: TakeIdentity): string => {
    const key = takeKey(identity)
    const take = record(identity)
    const base = old.get(key) ?? (take ? family.frame(take) : undefined)
    if (base) frames.push({ ...base, key, selected: same(identity, choices.selected) })
    return key
  }
  const chains = planChains(family.takes, choices.selected).map((chain): ChainView => {
    const parent = chain.parent ? add(chain.parent) : null
    const shown = add(chain.shown)
    const steps: ChainStepView[] = chain.steps.map(step => step.present
      ? { _tag: "Present", take: step.take, label: `Take ${step.take}`, selected: same(step, choices.selected) }
      : { _tag: "Discarded", take: step.take, label: `Take ${step.take}, discarded` })
    const label = historyLabel(steps.length)
    const shownTake = record(chain.shown)
    return {
      id: chain.id, shown, parent, take: chain.shown.take, label: lineageLabel(chain),
      history: steps.length < 2 ? { _tag: "None" } : choices.open.includes(chain.id) ? { _tag: "Open", label, steps } : { _tag: "Folded", label },
      flag: shownTake ? flagView(acceptFlag(shownTake, family.accepted)) : { _tag: "Current" },
      solo: parent ? choices.solo[chain.id] ?? "Shown" : "Shown",
    }
  })
  return { ...view, canvas: { ...view.canvas, mode: "Takes", frames, chains } }
}

/** The choices a view shows: its selected take frame, its open histories and each chain's side. */
export function readChoices(view: ChromeView): ChainChoices {
  const canvas = view.canvas._tag === "Frames" ? view.canvas : null
  const picked = canvas?.frames.find(frame => frame.take && frame.selected)
  return {
    selected: picked ? frameIdentity(picked) : null,
    open: canvas?.chains.filter(chain => chain.history._tag === "Open").map(chain => chain.id) ?? [],
    solo: Object.fromEntries(canvas?.chains.map(chain => [chain.id, chain.solo]) ?? []),
  }
}

/** The family whose takes a view's chains show, or null for a view with no chains. */
export function familyOf(view: ChromeView, families: readonly ChainFamily[]): ChainFamily | null {
  if (view.canvas._tag !== "Frames" || view.canvas.chains.length === 0) return null
  const shown = new Set(view.canvas.chains.map(chain => chain.shown))
  return families.find(family => family.takes.some(take => shown.has(takeKey(take)))) ?? null
}
