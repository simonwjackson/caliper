import type { ChromeView, Availability, CanvasView, FrameView, NavigationView, SetupRow, TakeSummary, Badge, IntegrationView, CodeView, KnobsView, ChecksView, MarkupView, MarkPin, AcceptFlag, ChainView } from "../ui/contract"
import { acceptFlag, acceptNote, flagWords, historyLabel, lineageLabel, planChains } from "../../takes/chains.js"
import type { AcceptFlag as ChainFlag, AcceptRecord, ChainTake } from "../../takes/chains.js"
import type { Derivation, StateRef, TakeView } from "../../types"
import { DEVICES } from "../device-frame.js"
import { contextsFor, subjectsOf, sameState, stateExists } from "../scenarios.js"
import { MAX_IMAGES } from "../images.js"
import type { AppState } from "./state"
import { currentPart, currentTake, subjectRef, previewRef, partTakes, refLabel, takeAvailable, takeName, frameKey } from "./state"

/** Marks as the markup controller sees them. `frame` reads its current locations; it does no I/O. */
export type MarkupRegion = {
  view: MarkupView
  frame: (key: string, frame: Pick<FrameView, "take" | "preview">) => { markable: Availability; marks: readonly MarkPin[] }
  /** Names of marks on the original that go with the typed prompt (planner choice 14). */
  withPrompt: readonly string[]
}
const promptMarks = (names: readonly string[]): ChromeView["composer"]["marks"] => names.length
  ? { _tag: "WithPrompt", names, label: `${names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`} ${names.length === 1 ? "goes" : "go"} with this prompt.` }
  : { _tag: "None" }
export type Regions = { code: CodeView; knobs: KnobsView; checks: ChecksView; integration: IntegrationView; badges?: readonly { part: string; state: string; take?: string; badge: Badge }[]; markup?: MarkupRegion }
const noMarkup: MarkupRegion = { view: { _tag: "Unavailable", reason: "Loading the draft of marks…" }, frame: () => ({ markable: disabled("Loading the draft of marks…"), marks: [] }), withPrompt: [] }
/** A take as the chain policy reads it: its subject, files, and the chain fields of its record. */
const chainTake = (take: TakeView): ChainTake => ({
  take: take.take, created: take.created, part: take.part, state: take.state, files: take.files,
  ...(take.chain ? { chain: take.chain } : {}), ...(take.lineage ? { lineage: take.lineage } : {}),
})
const acceptLog = (state: AppState): readonly AcceptRecord[] => state.takes?.accepted ?? []
const flagView = (flag: ChainFlag): AcceptFlag => {
  const words = flagWords(flag)
  return flag._tag === "Before" && words ? { _tag: "Before", take: flag.take, ...words } : { _tag: "Current" }
}
export const enabled: Availability = { _tag: "Enabled" }
export const disabled = (reason: string): Availability => ({ _tag: "Disabled", reason })
export function takeSummary(state: AppState, take: TakeView): TakeSummary {
  const unavailableReason = takeAvailable(state, take) ? "" : "The editing state or its recorded context is unavailable. Restore the declaration or discard this take."
  const block = state.connection._tag !== "Ready" ? "Vite is not reachable." : state.operation._tag === "Working" ? "A request is pending." : take.run._tag === "Running" ? "The agent is working." : unavailableReason || (take.files.length === 0 ? "No changed files." : "")
  return {
    id: take.take, name: takeName(take), subjectLabel: refLabel(state, take), deviceLabel: DEVICES.find(device => device.id === take.device)?.name ?? take.device,
    createdLabel: take.context ? `Made in ${refLabel(state, take.context)}` : "",
    run: take.run, files: take.files, nameIssue: take.nameIssue ?? "", direction: take.direction ?? null, unavailableReason,
    kind: take.integration ? "Alternate" : "Experiment",
    accept: block ? disabled(block) : take.integration ? disabled("Review and apply this alternate instead.") : enabled,
    discard: state.operation._tag === "Working" ? disabled("A request is pending.") : state.connection._tag !== "Ready" ? disabled("Vite is not reachable.") : enabled,
    stop: take.run._tag === "Running" && state.connection._tag === "Ready" ? enabled : disabled("No agent is running."),
    prepareAlternate: block ? disabled(block) : take.integration ? disabled("This is already an alternate proposal.") : state.takes?.agent._tag !== "Ready" ? disabled("The agent is not ready.") : enabled,
    ...chainFacts(state, take),
  }
}
const chainWith = (state: AppState, take: TakeView) => planChains((state.takes?.takes ?? []).map(chainTake), take).find(item => item.shown.take === take.take && item.shown.created === take.created)
function chainFacts(state: AppState, take: TakeView): Pick<TakeSummary, "lineage" | "flag"> {
  const chain = chainWith(state, take)
  return {
    lineage: chain && (chain.parent || chain.discarded) ? lineageLabel(chain) : "",
    flag: flagView(acceptFlag(chainTake(take), acceptLog(state))),
  }
}
/** Whether the chain has a pair to swap, so `onChainSolo` may choose its parent. */
export function chainHasParent(state: AppState, id: string): boolean {
  return planChains(partTakes(state).map(chainTake), currentTake(state)).some(chain => chain.id === id && chain.parent !== null)
}
/** Planner choice 20 (answered B): what Accept also removes, said only in its confirmation. */
export function acceptConfirmNote(state: AppState, take: TakeView): string {
  const chain = chainWith(state, take)
  return chain ? acceptNote(chain, take) : ""
}
function setupRow<T>(label: string, value: Derivation<T>, show: (value: T) => string[]): SetupRow {
  return value._tag === "Failed" ? { label, status: "Failed", values: [], provenance: value.hint, problems: [value.reason] }
    : { label, status: value._tag, values: show(value.value), provenance: value._tag === "Derived" ? `Found at ${value.source.file}:${value.source.line}: ${value.via}` : `Set by caliper({ ${value.option} }) in vite.config`, problems: [] }
}
/** The switcher shows while another project runs; this tab's project stays listed even when its server is away. */
function projectsView(state: AppState): NavigationView["projects"] {
  const others = state.projects.filter(project => project.id !== state.projectId)
  if (state.projectId === null || others.length === 0) return { _tag: "Hidden" }
  const current = state.projects.find(project => project.id === state.projectId) ?? { id: state.projectId, name: state.project?.name ?? "This project", problem: "" }
  return { _tag: "Choices", choices: [current, ...others].map(project => ({ ...project, current: project.id === state.projectId, problem: project.id === state.projectId ? "" : project.problem }))
    .sort((left, right) => left.name.localeCompare(right.name)) }
}
function navigation(state: AppState, regions: Regions): NavigationView {
  const parts = state.project?.parts ?? []
  const subject = subjectRef(state), preview = previewRef(state)
  const needle = state.filter.trim().toLowerCase()
  const shown = parts.filter(part => !needle || `${part.name}\n${part.file}`.toLowerCase().includes(needle))
  const layers = ["page", "template", "organism", "molecule", "atom", undefined]
  shown.sort((a, b) => layers.indexOf(a.layer) - layers.indexOf(b.layer) || a.file.localeCompare(b.file))
  const badge = (part: string, exported: string, take?: string) => regions.badges?.find(row => row.part === part && row.state === exported && row.take === take)?.badge
  const navTake = (take: TakeView) => ({ id: take.take, label: `${takeName(take)} · Take ${take.take}`, selected: take.take === state.take, badge: badge(take.part, take.state, take.take) })
  const unavailable = new Map<string, { subject: StateRef; label: string; takes: ReturnType<typeof navTake>[] }>()
  for (const take of state.takes?.takes ?? []) {
    if (stateExists(parts, take)) continue
    const key = JSON.stringify([take.part, take.state])
    const group = unavailable.get(key) ?? { subject: { part: take.part, state: take.state }, label: `${refLabel(state, take)} · removed`, takes: [] }
    group.takes.push(navTake(take)); unavailable.set(key, group)
  }
  const contexts = subject ? contextsFor(parts, subject) : []
  const contextKey = (ref: StateRef | null) => ref ? JSON.stringify([ref.part, ref.state]) : "isolated"
  const project = state.project
  return {
    project: project?.name ?? "Caliper", projects: projectsView(state), filter: state.filter,
    countLabel: state.connection._tag === "Unreachable" ? "Vite is not reachable" : needle ? `${shown.length} of ${parts.length}` : `${parts.length} parts`,
    emptyMessage: !project ? state.connection._tag === "Connecting" ? "Connecting to Vite…" : "Vite is not reachable." : parts.length === 0 ? "No *.part.tsx files found. A part file default-exports a component that renders with no props." : shown.length === 0 ? `No part matches “${state.filter}”.` : "",
    parts: shown.map(part => ({ file: part.file, name: part.name, note: part.note ?? "", layer: part.layer, layerSite: part.layerSource ? `${part.layer} · ${part.layerSource.file}:${part.layerSource.line}` : part.layer ? `${part.layer} · filename suffix in ${part.file}` : `Unclassified · ${part.file}`,
      selected: part.file === state.part, expanded: state.expanded.get(part.file) ?? part.file === state.part,
      states: part.states.map(item => ({ ref: { part: part.file, state: item.export }, label: item.label, site: item.line ? `${part.file}:${item.line}` : `${part.file}: default export`, selected: part.file === state.part && state.shown._tag !== "All" && item.export === state.shown.export,
        badge: badge(part.file, item.export), takes: partTakes(state, part.file, item.export).map(navTake), comparing: part.file === state.part && state.shown._tag === "Takes" && item.export === state.shown.export })),
    })),
    scenario: subject && preview ? { _tag: "Selected", subject, editingLabel: `Editing ${refLabel(state, subject)}`, choices: [null, ...contexts].map(ref => ({ key: contextKey(ref), label: ref ? refLabel(state, ref) : `Isolated · ${refLabel(state, subject)}`, context: ref })), chosen: contextKey(state.context),
      note: state.contextNote,
      whole: state.context ? { ref: preview, label: refLabel(state, preview) } : null,
      children: subjectsOf(parts, preview).map(ref => ({ ref, label: refLabel(state, ref), selected: sameState(subject, ref) })),
    } : { _tag: "None" }, unavailable: [...unavailable.values()],
    setup: project ? [setupRow("Entry", project.entry, entry => [entry.file]), setupRow("Global CSS", project.css, css => [css.stylesheets.length ? css.stylesheets.map(sheet => `${sheet.file}${sheet.importedAt ? ` from ${sheet.importedAt.file}:${sheet.importedAt.line}` : " from caliper({ css })"}`).join("\n") : "No global stylesheets injected. Components load their own CSS.", ...css.unresolved.map(miss => `${miss.specifier} at ${miss.at.file}:${miss.at.line}`)]), setupRow("Wrapper", project.wrapper, wrapper => [wrapper.elements.length ? wrapper.elements.map(element => `<${element.tag}${element.className ? ` class=\"${element.className}\"` : ""}>`).join("") : "None: parts render straight into the page.", ...(wrapper.renderedAt ? [`App rendered at ${wrapper.renderedAt.file}:${wrapper.renderedAt.line}`] : [])])] : [],
    setupProblems: parts.flatMap(part => [...part.compositionProblems ?? [], ...part.expectationProblems ?? [], ...part.authoredCheckProblems ?? []]),
  }
}
/** The state's own label, as the canvas shows it beside the part's name; a composed preview names its scenario. */
function selectionLabel(state: AppState, subject: StateRef) {
  const own = state.project?.parts.find(part => part.file === subject.part)?.states.find(item => item.export === subject.state)?.label ?? subject.state
  return state.context ? `${own} in ${refLabel(state, state.context)}` : own
}
function canvas(state: AppState, markup: MarkupRegion): CanvasView {
  const part = currentPart(state), subject = subjectRef(state), preview = previewRef(state)
  if (!part || (subject && !stateExists(state.project?.parts ?? [], subject))) return { _tag: "Empty", message: currentTake(state) ? "This take's editing state is no longer available. Restore it or discard the take." : "Pick a part from the list." }
  const frames: FrameView[] = []
  const add = (ref: StateRef, editing: StateRef, take: TakeView | null, label: string): string => {
    const key = frameKey(ref, take), report = state.reports.get(key)
    const marking = markup.frame(key, { take: take?.take ?? null, preview: ref })
    frames.push({ key, label, title: take ? take.files.join("\n") || "No changes yet" : `${refLabel(state, ref)} · ${ref.part}`, src: `frame?${new URLSearchParams({ part: ref.part, state: ref.state, ...(take ? { take: take.take } : {}) })}`, subject: editing, preview: ref, take: take?.take ?? null, selected: take ? take.take === state.take : state.take === null,
      ...(take ? { run: take.run } : {}), verdict: { _tag: report?.state ?? "Loading" }, problems: report?.problems ?? [], marks: marking.marks, markable: marking.markable })
    return key
  }
  if (state.shown._tag === "All" && part.states.length > 1) {
    for (const item of part.states) add({ part: part.file, state: item.export }, { part: part.file, state: item.export }, null, item.label)
    return { _tag: "Frames", mode: "All", title: part.name, frames, chains: [] }
  }
  const editing = subject ?? { part: part.file, state: "default" }
  const viewed = preview ?? editing
  const takes = partTakes(state)
  if (state.shown._tag === "Takes" && takes.length) {
    add(viewed, editing, null, sameState(viewed, editing) ? "Real files" : refLabel(state, viewed))
    const addTake = (take: TakeView) => add(take.integration?._tag === "Review" ? take.integration.proposal.preview : viewed, editing, take, takeName(take))
    const find = (identity: { take: string; created: number }) => takes.find(take => take.take === identity.take && take.created === identity.created)
    const selected = currentTake(state)
    const chains: ChainView[] = []
    for (const chain of planChains(takes.map(chainTake), selected)) {
      const shown = find(chain.shown), parent = chain.parent ? find(chain.parent) : undefined
      if (!shown) continue
      const parentKey = parent ? addTake(parent) : null
      chains.push({
        id: chain.id, shown: addTake(shown), parent: parentKey, take: shown.take, label: lineageLabel(chain),
        history: chain.steps.length < 2 ? { _tag: "None" }
          : state.chainsOpen.has(chain.id) ? { _tag: "Open", label: historyLabel(chain.steps.length), steps: chain.steps.map(step => step.present
            ? { _tag: "Present", take: step.take, label: `Take ${step.take}`, selected: step.take === chain.shown.take && step.created === chain.shown.created }
            : { _tag: "Discarded", take: step.take, label: `Take ${step.take}, discarded` }) }
          : { _tag: "Folded", label: historyLabel(chain.steps.length) },
        flag: flagView(acceptFlag(chainTake(shown), acceptLog(state))),
        // Planner choice 19 (answered B): core remembers the side per chain; a chain with no parent shows its take.
        solo: parentKey !== null && state.chainSolo.has(chain.id) ? "Parent" : "Shown",
      })
    }
    return { _tag: "Frames", mode: "Takes", title: part.name, frames, chains }
  }
  add(viewed, editing, null, sameState(viewed, editing) ? "Real files" : refLabel(state, viewed))
  return { _tag: "Frames", mode: "One", title: part.name, frames, chains: [] }
}
/** No I/O, DOM reads or state mutation. Controllers supply derived region snapshots. */
export function toChromeView(state: AppState, regions: Regions): ChromeView {
  const subject = subjectRef(state), preview = previewRef(state), take = currentTake(state)
  const summary = take ? takeSummary(state, take) : null
  const busy = state.operation._tag === "Working"
  const agentReady = state.takes?.agent._tag === "Ready"
  const startReason = state.connection._tag !== "Ready" ? "Vite is not reachable." : busy ? "A request is pending." : !agentReady ? "The agent is not ready." : !subject || !stateExists(state.project?.parts ?? [], subject) ? "Choose an available editing state." : !state.prompt.trim() ? "Describe a change first." : ""
  const edit = agentReady && state.plan._tag === "None" ? enabled : disabled("The agent is not ready, or takes are being planned.")
  const attach = edit._tag === "Enabled" && state.attachments.length < MAX_IMAGES && !busy ? enabled : disabled("The composer cannot attach more images now.")
  const snapshot: ChromeView = {
    connection: state.connection, selection: subject && preview ? { _tag: "State", subject, preview, label: selectionLabel(state, subject) } : state.part ? { _tag: "All", part: state.part } : { _tag: "None" },
    navigation: navigation(state, regions), devices: DEVICES, device: state.device, pxPerMm: state.pxPerMm, calibrated: state.calibrated, tools: state.tools, canvas: canvas(state, regions.markup ?? noMarkup),
    plan: state.plan._tag === "Planning" ? { _tag: "Planning", count: state.plan.count, message: `Planning ${state.plan.count} takes…` } : { _tag: "None" },
    composer: { prompt: state.prompt, placeholder: currentPart(state) ? `Describe a change to ${currentPart(state)?.name}` : "Describe a change", edit, attach, attachments: state.attachments.map(image => ({ id: image.id, name: image.name, url: image.url, remove: edit })), count: state.count, start: startReason ? disabled(startReason) : enabled, startLabel: state.count === 1 ? "New take" : `${state.count} new takes`,
      follow: take && state.plan._tag === "None" ? { take: take.take, label: `Send to take ${take.take}`, availability: !startReason && take.run._tag !== "Running" && takeAvailable(state, take) ? enabled : disabled(startReason || summary?.unavailableReason || "The agent is working.") } : null,
      marks: promptMarks(state.plan._tag === "None" ? (regions.markup ?? noMarkup).withPrompt : []),
      notices: state.notices, agent: state.takes?.agent ?? { _tag: "Connecting" }, skills: state.takes?.skills ?? { skills: [], problems: [] } },
    markup: (regions.markup ?? noMarkup).view,
    focusedTake: summary,
    record: take && summary && state.tools.side === "record" ? { _tag: "Open", take: summary, log: take.log.filter(entry => entry._tag !== "Assistant" || entry.text !== "").map(entry => entry._tag === "User" ? { _tag: "User", text: entry.text, images: (entry.images ?? []).map(file => ({ name: take.images.find(image => image.file === file)?.name ?? file, url: `takes/${take.take}/images/${encodeURIComponent(file)}` })) } : entry), emptyLogMessage: "This take has no conversation since Vite started. Send a prompt to go on.", integration: regions.integration } : { _tag: "Closed" },
    code: regions.code, knobs: regions.knobs, checks: regions.checks,
    calibration: state.calibrationOpen ? { _tag: "Open", pxPerMm: state.pxPerMm, calibrated: state.calibrated } : { _tag: "Closed" },
  }
  return freezeSnapshot(structuredClone(snapshot))
}
function freezeSnapshot<T>(value: T): T {
  if (typeof value === "object" && value !== null) { for (const item of Object.values(value)) freezeSnapshot(item); Object.freeze(value) }
  return value
}
