import type { ChromeView, Availability, CanvasView, FrameView, NavigationView, SetupRow, TakeSummary, Badge, IntegrationView, CodeView, KnobsView, ChecksView } from "../ui/contract"
import type { Derivation, StateRef, TakeView } from "../../types"
import { DEVICES } from "../device-frame.js"
import { contextsFor, subjectsOf, sameState, stateExists } from "../scenarios.js"
import { MAX_IMAGES } from "../images.js"
import type { AppState } from "./state"
import { currentPart, currentTake, subjectRef, previewRef, partTakes, refLabel, askAvailable, takeAvailable, takeName, frameKey } from "./state"

export type Regions = { code: CodeView; knobs: KnobsView; checks: ChecksView; integration: IntegrationView; badges?: readonly { part: string; state: string; take?: string; badge: Badge }[] }
export const enabled: Availability = { _tag: "Enabled" }
export const disabled = (reason: string): Availability => ({ _tag: "Disabled", reason })
export function takeSummary(state: AppState, take: TakeView): TakeSummary {
  const unavailableReason = takeAvailable(state, take) ? "" : "The editing state or its recorded context is unavailable. Restore the declaration or discard this take."
  const block = state.connection._tag !== "Ready" ? "Vite is not reachable." : state.operation._tag === "Working" ? "A request is pending." : take.run._tag === "Running" ? "The agent is working." : unavailableReason || (take.files.length === 0 ? "No changed files." : "")
  return {
    id: take.take, name: takeName(take), subjectLabel: refLabel(state, take), deviceLabel: DEVICES.find(device => device.id === take.device)?.name ?? take.device,
    createdLabel: `${new Date(take.created).toISOString()} · ${take.context ? `Created in ${refLabel(state, take.context)}` : "Created in isolation"}. Shared source edits can affect other states.`,
    run: take.run, files: take.files, nameIssue: take.nameIssue ?? "", direction: take.direction ?? null, unavailableReason,
    kind: take.integration ? "Alternate" : "Experiment",
    accept: block ? disabled(block) : take.integration ? disabled("Review and apply this alternate instead.") : enabled,
    discard: state.operation._tag === "Working" ? disabled("A request is pending.") : state.connection._tag !== "Ready" ? disabled("Vite is not reachable.") : enabled,
    stop: take.run._tag === "Running" && state.connection._tag === "Ready" ? enabled : disabled("No agent is running."),
    prepareAlternate: block ? disabled(block) : take.integration ? disabled("This is already an alternate proposal.") : state.takes?.agent._tag !== "Ready" ? disabled("The agent is not ready.") : enabled,
  }
}
function setupRow<T>(label: string, value: Derivation<T>, show: (value: T) => string[]): SetupRow {
  return value._tag === "Failed" ? { label, status: "Failed", values: [], provenance: value.hint, problems: [value.reason] }
    : { label, status: value._tag, values: show(value.value), provenance: value._tag === "Derived" ? `Found at ${value.source.file}:${value.source.line}: ${value.via}` : `Set by caliper({ ${value.option} }) in vite.config`, problems: [] }
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
    project: project?.name ?? "Caliper", filter: state.filter,
    countLabel: state.connection._tag === "Unreachable" ? "Vite is not reachable" : needle ? `${shown.length} of ${parts.length}` : `${parts.length} parts`,
    emptyMessage: !project ? state.connection._tag === "Connecting" ? "Connecting to Vite…" : "Vite is not reachable." : parts.length === 0 ? "No *.part.tsx files found. A part file default-exports a component that renders with no props." : shown.length === 0 ? `No part matches “${state.filter}”.` : "",
    parts: shown.map(part => ({ file: part.file, name: part.name, note: part.note ?? "", layer: part.layer, layerSite: part.layerSource ? `${part.layer} · ${part.layerSource.file}:${part.layerSource.line}` : part.layer ? `${part.layer} · filename suffix in ${part.file}` : `Unclassified · ${part.file}`,
      selected: part.file === state.part, expanded: state.expanded.get(part.file) ?? part.file === state.part,
      states: part.states.map(item => ({ ref: { part: part.file, state: item.export }, label: item.label, site: item.line ? `${part.file}:${item.line}` : `${part.file}: default export`, selected: part.file === state.part && state.shown._tag !== "All" && item.export === state.shown.export,
        badge: badge(part.file, item.export), takes: partTakes(state, part.file, item.export).map(navTake), comparing: part.file === state.part && state.shown._tag === "Takes" && item.export === state.shown.export })),
    })),
    scenario: subject && preview ? { _tag: "Selected", subject, editingLabel: `Editing ${refLabel(state, subject)}`, choices: [null, ...contexts].map(ref => ({ key: contextKey(ref), label: ref ? refLabel(state, ref) : `Isolated · ${refLabel(state, subject)}`, context: ref })), chosen: contextKey(state.context),
      note: state.contextNote || (contexts.length === 0 && subjectsOf(parts, preview).length === 0 ? "No composed scenarios declared. Add composition to a part file to connect its real scenarios to child states." : ""),
      whole: state.context ? { ref: preview, label: refLabel(state, preview) } : null,
      children: subjectsOf(parts, preview).map(ref => ({ ref, label: refLabel(state, ref), selected: sameState(subject, ref) })),
    } : { _tag: "None" }, unavailable: [...unavailable.values()],
    setup: project ? [setupRow("Entry", project.entry, entry => [entry.file]), setupRow("Global CSS", project.css, css => [css.stylesheets.length ? css.stylesheets.map(sheet => `${sheet.file}${sheet.importedAt ? ` from ${sheet.importedAt.file}:${sheet.importedAt.line}` : " from caliper({ css })"}`).join("\n") : "No global stylesheets injected. Components load their own CSS.", ...css.unresolved.map(miss => `${miss.specifier} at ${miss.at.file}:${miss.at.line}`)]), setupRow("Wrapper", project.wrapper, wrapper => [wrapper.elements.length ? wrapper.elements.map(element => `<${element.tag}${element.className ? ` class=\"${element.className}\"` : ""}>`).join("") : "None: parts render straight into the page.", ...(wrapper.renderedAt ? [`App rendered at ${wrapper.renderedAt.file}:${wrapper.renderedAt.line}`] : [])])] : [],
    setupProblems: parts.flatMap(part => [...part.compositionProblems ?? [], ...part.expectationProblems ?? [], ...part.authoredCheckProblems ?? []]),
  }
}
function canvas(state: AppState): CanvasView {
  const part = currentPart(state), subject = subjectRef(state), preview = previewRef(state)
  if (!part || (subject && !stateExists(state.project?.parts ?? [], subject))) return { _tag: "Empty", message: currentTake(state) ? "This take's editing state is no longer available. Restore it or discard the take." : "Pick a part from the list." }
  const frames: FrameView[] = []
  const add = (ref: StateRef, editing: StateRef, take: TakeView | null, label: string) => {
    const key = frameKey(ref, take), report = state.reports.get(key)
    frames.push({ key, label, title: take ? take.files.join("\n") || "No changes yet" : `${refLabel(state, ref)} · ${ref.part}`, src: `frame?${new URLSearchParams({ part: ref.part, state: ref.state, ...(take ? { take: take.take } : {}) })}`, subject: editing, preview: ref, take: take?.take ?? null, selected: take ? take.take === state.take : state.take === null,
      ...(take ? { run: take.run } : {}), verdict: { _tag: report?.state ?? "Loading" }, problems: report?.problems ?? [], marks: [], markable: disabled("Take markup is not connected yet.") })
  }
  if (state.shown._tag === "All" && part.states.length > 1) {
    for (const item of part.states) add({ part: part.file, state: item.export }, { part: part.file, state: item.export }, null, item.label)
    return { _tag: "Frames", mode: "All", title: `${part.name} · All ${part.states.length} states`, frames }
  }
  const editing = subject ?? { part: part.file, state: "default" }
  const viewed = preview ?? editing
  const takes = partTakes(state)
  if (state.shown._tag === "Takes" && takes.length) {
    add(viewed, editing, null, "Original")
    for (const take of takes) add(take.integration?._tag === "Review" ? take.integration.proposal.preview : viewed, editing, take, takeName(take))
    return { _tag: "Frames", mode: "Takes", title: `${refLabel(state, editing)} · Original and ${takes.length} takes`, frames }
  }
  add(viewed, editing, null, refLabel(state, viewed))
  return { _tag: "Frames", mode: "One", title: refLabel(state, editing), frames }
}
/** No I/O, DOM reads or state mutation. Controllers supply derived region snapshots. */
export function toChromeView(state: AppState, regions: Regions): ChromeView {
  const subject = subjectRef(state), preview = previewRef(state), take = currentTake(state)
  const summary = take ? takeSummary(state, take) : null
  const busy = state.operation._tag === "Working"
  const agentReady = state.takes?.agent._tag === "Ready"
  const startReason = state.connection._tag !== "Ready" ? "Vite is not reachable." : busy ? "A request is pending." : !agentReady ? "The agent is not ready." : !subject || !stateExists(state.project?.parts ?? [], subject) ? "Choose an available editing state." : !state.prompt.trim() ? "Describe a change first." : ""
  const edit = agentReady && state.plan._tag === "None" ? enabled : disabled("The agent is not ready, or a plan is open.")
  const attach = edit._tag === "Enabled" && state.attachments.length < MAX_IMAGES && !busy ? enabled : disabled("The composer cannot attach more images now.")
  const valid = state.plan._tag === "Review" ? state.plan.directions.filter(item => item.direction.title.trim() && item.direction.brief.trim()).length : 0
  const snapshot: ChromeView = {
    connection: state.connection, selection: subject && preview ? { _tag: "State", subject, preview, label: refLabel(state, subject) } : state.part ? { _tag: "All", part: state.part } : { _tag: "None" },
    navigation: navigation(state, regions), devices: DEVICES, device: state.device, pxPerMm: state.pxPerMm, calibrated: state.calibrated, tools: state.tools, canvas: canvas(state),
    plan: state.plan._tag === "Planning" ? { _tag: "Planning", prompt: state.plan.ask.prompt, count: state.plan.count, message: `Asking the model for ${state.plan.count} different directions…` } : state.plan._tag === "Review" ? { _tag: "Review", prompt: state.plan.ask.prompt, note: state.plan.note, directions: state.plan.directions, start: !busy && valid && agentReady && state.connection._tag === "Ready" && askAvailable(state, state.plan.ask) ? enabled : disabled("No valid directions, unavailable planned subject/context, disconnected Vite, or pending request."), startLabel: `Start ${valid} ${valid === 1 ? "take" : "takes"}` } : { _tag: "None" },
    composer: { prompt: state.prompt, placeholder: "Describe a change to this part. Paste or drop reference images.", edit, attach, attachments: state.attachments.map(image => ({ id: image.id, name: image.name, url: image.url, remove: edit })), count: state.count, start: startReason ? disabled(startReason) : enabled, startLabel: state.count === 1 ? "New take" : `Plan ${state.count} takes`,
      follow: take && state.plan._tag === "None" ? { take: take.take, label: `Send to take ${take.take}`, availability: !startReason && take.run._tag !== "Running" && takeAvailable(state, take) ? enabled : disabled(startReason || summary?.unavailableReason || "The agent is working.") } : null,
      notices: [...state.notices, ...(agentReady && subject ? [{ kind: "info" as const, text: `Editing ${refLabel(state, subject)}${state.context ? ` in ${refLabel(state, state.context)}` : ""} on ${state.device.name}. Ctrl+Enter starts or plans takes${take ? `; Ctrl+Shift+Enter sends to take ${take.take}` : ""}.` }] : [])], agent: state.takes?.agent ?? { _tag: "Connecting" }, skills: state.takes?.skills ?? { skills: [], problems: [] } },
    markup: { _tag: "Unavailable", reason: "Take markup is not connected yet." },
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
