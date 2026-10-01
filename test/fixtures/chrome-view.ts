import { planSend, referencesIn } from "../../src/takes/send-plan.js"
import { acceptFlag, flagWords, historyLabel, lineageLabel, planChains } from "../../src/takes/chains.js"
import type { AcceptRecord, ChainTake } from "../../src/takes/chains.js"
import type { AcceptFlag, Availability, ChainStepView, ChainView, ChromeView, DraftMarkView, FrameView, MarkupOutcome, MarkupView, TakeSummary } from "../../src/client/ui/contract"
import { STANDARD_DEVICES, DEFAULT_PX_PER_MM } from "../../src/client/device-frame.js"
import { WORKSPACE_SCENES, workspaceScene } from "../../src/client/ui/fixtures/workspaces"

export const enabled: Availability = { _tag: "Enabled" }
export const blocked: Availability = { _tag: "Disabled", reason: "Unavailable in this scenario" }
const subject = { part: "src/Button.atom.part.tsx", state: "default" }
const preview = { part: "src/Page.page.part.tsx", state: "MenuOpen" }
const device = STANDARD_DEVICES[0]
if (!device) throw new Error("The contract fixture needs one built-in device")
const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jzQAAAABJRU5ErkJggg=="
const take: TakeSummary = {
  id: "6", name: "Quiet button", subjectLabel: "Button · Default", deviceLabel: device.name,
  createdLabel: "Made in Page · Menu open",
  run: { _tag: "Idle" }, files: ["src/Button.tsx", "src/Button.css"], nameIssue: "", direction: { title: "Quiet button", brief: "Use the shared inputs", strange: true },
  unavailableReason: "", accept: enabled, discard: enabled, stop: blocked, prepareAlternate: enabled, kind: "Experiment",
  lineage: "", flag: { _tag: "Current" },
}
const frame: FrameView = {
  key: "6@1234", label: "Quiet button", title: "Changes src/Button.tsx", src: "/frame?take=6",
  subject, preview, take: "6", selected: true, run: { _tag: "Idle" }, verdict: { _tag: "Rendered" }, problems: [], marks: [], markable: enabled,
}

/** Contract examples, not a second renderer or a server snapshot adapter. Each call supplies fresh values. */
export function readyView(): ChromeView {
  return structuredClone({
    connection: { _tag: "Ready" }, selection: { _tag: "State", subject, preview, label: "Button · Default in Page · Menu open" },
    navigation: {
      project: "Caliper", filter: "", countLabel: "2 parts", emptyMessage: "", workspaces: { items: [{ id: "1", name: "Quieter buttons", meta: "Open · no ideas yet", selected: false, problem: "" }], create: enabled },
      projects: { _tag: "Choices", choices: [{ id: "aaaaaaaaaaaa", name: "Caliper", current: true, problem: "" }, { id: "bbbbbbbbbbbb", name: "Pico", current: false, problem: "" }] },
      parts: [{ file: subject.part, name: "Button", note: "A composed preview", layer: "atom", layerSite: "filename suffix", selected: true, expanded: true, pinned: 0,
        states: [{ ref: subject, label: "Default", site: subject.part, selected: true, comparing: true, badge: { status: "Review", label: "Needs review", detail: "Named coverage only" }, takes: [{ id: "6", label: "Quiet button", selected: true }], pin: { _tag: "None" } }] }],
      scenario: { _tag: "Selected", subject, editingLabel: "Editing Button · Default", choices: [{ key: "isolated", label: "Isolated", context: null }, { key: "page", label: "Page · Menu open", context: preview }], chosen: "page", note: "",
        whole: { ref: preview, label: "Page · Menu open" }, children: [{ ref: subject, label: "Button · Default", selected: true }] },
      unavailable: [{ subject: { part: "src/Removed.part.tsx", state: "Gone" }, label: "Removed state", takes: [{ id: "8", label: "Take 8 · review or discard", selected: false }] }],
      setup: [{ label: "Entry", status: "Derived", values: ["src/mount.tsx"], provenance: "package.json:1", problems: [] }, { label: "CSS", status: "Overridden", values: ["src/global.css"], provenance: "vite.config", problems: [] }, { label: "Wrapper", status: "Failed", values: [], provenance: "Set caliper({wrap})", problems: ["Wrapper not found"] }], setupProblems: ["A declaration needs review"],
    },
    devices: STANDARD_DEVICES, device, pxPerMm: DEFAULT_PX_PER_MM, calibrated: false,
    tools: { active: "takes", navOpen: true, codeOpen: true, side: "record", codeShare: 0.45 },
    canvas: { _tag: "Frames", mode: "Takes", title: "Button", frames: [{ ...frame, key: "real", label: "Original", src: "/frame", take: null, selected: false, markable: enabled }, frame],
      chains: [{ id: "6@1234", shown: frame.key, parent: null, take: "6", label: "6", history: { _tag: "None" }, flag: { _tag: "Current" }, solo: "Shown" }] },
    plan: { _tag: "None" }, composer: {
      prompt: "Make the button quiet", placeholder: "Describe a change", edit: enabled, attach: enabled,
      attachments: [{ id: "image-1", name: "reference.png", url: pixel, remove: enabled }], count: 3, start: enabled, startLabel: "Plan 3 takes",
      follow: { take: "6", label: "Send to take 6", availability: enabled }, marks: { _tag: "WithPrompt", names: ["0A"], label: "0A goes with this prompt." }, notices: [{ kind: "info", text: "Editing the subject, not the scenario" }],
      agent: { _tag: "Ready", model: "configured-model", baseUrl: "https://example.invalid/v1", reasoning: "high", api: "responses", baseUrlFrom: "~/.config/caliper/config.json", keyFrom: "CALIPER_AGENT_API_KEY" },
      skills: { skills: [{ name: "design", description: "Describe a change", scope: "project", location: ".agents/skills/design/SKILL.md" }], problems: [] },
      models: { _tag: "Ready", current: "configured-model", favorites: ["configured-model"], models: ["other-model"], problem: "", choosing: null },
    },
    markup: { _tag: "Unavailable", reason: "Take markup is not connected yet" },
    focusedTake: take, record: { _tag: "Open", take, emptyLogMessage: "No conversation since Vite started", integration: { _tag: "None" },
      log: [{ _tag: "User", text: "Make it quiet", images: [{ name: "reference.png", url: pixel }] }, { _tag: "Assistant", text: "Changed the spacing" }, { _tag: "Edit", file: "src/Button.css" }, { _tag: "Tool", name: "render", subject: "default@iphone-16", outcome: "Done", detail: "Rendered" }] },
    code: { _tag: "Ready", files: [{ file: "src/Button.tsx", label: "Button.tsx", depth: 1, changed: true, added: 1, removed: 1 }, { file: subject.part, label: "Button.atom.part.tsx", depth: 0, changed: false }], tabs: ["src/Button.tsx"], filter: "", selectedFile: "src/Button.tsx",
      document: { file: "src/Button.tsx", content: "export const value = 2\n", original: "export const value = 1\n" }, documentKey: "6@1234|src/Button.tsx", mode: { _tag: "Take", original: "export const value = 1\n" }, save: { _tag: "Saved", label: "Saved to the take" }, notice: "", changes: 1, take: "6", stop: blocked, lenses: [{ export: "default", label: "Default", current: true }] },
    knobs: { _tag: "Ready", target: "Real files", skipped: [{ name: "--output", where: ".button", reason: "Computed output" }], problems: [],
      knobs: [
        { id: "gap", name: "--gap", label: "Gap", value: "8px", origin: "Property", where: ".button", source: { file: "src/Button.css", line: 2 }, note: "Space between controls", problems: [], control: { _tag: "Number", number: 8, unit: "px", step: 1, min: 0, max: 40 }, write: { _tag: "Idle" }, edit: enabled },
        { id: "threshold", name: "@container", label: "Stage width <", value: "45em", origin: "Threshold", where: "width < 45em", source: { file: "src/Button.css", line: 20 }, note: "No invented upper bound", problems: [], control: { _tag: "Number", number: 45, unit: "em", step: 1, min: 0 }, write: { _tag: "Conflict", reason: "Source changed" }, edit: enabled },
        { id: "color", name: "--ink", label: "Ink", value: "#112233", origin: "Plain", where: ".button", source: { file: "src/Button.css", line: 3 }, note: "", problems: [], control: { _tag: "Color", hex: "#112233" }, write: { _tag: "Saved" }, edit: enabled },
        { id: "choice", name: "--shape", label: "Shape", value: "round", origin: "Property", where: "@property", source: { file: "src/Button.css", line: 4 }, note: "", problems: [], control: { _tag: "Choice", options: ["round", "square"] }, write: { _tag: "Saving" }, edit: enabled },
        { id: "token", name: "--bg", label: "Background", value: "var(--ink)", origin: "Plain", where: ".button", source: { file: "src/Button.css", line: 5 }, note: "", problems: [], control: { _tag: "Token", chosen: "--ink", options: [{ name: "--ink", value: "#112233" }, { name: "--paper", value: "#ffffff" }], color: true }, write: { _tag: "Failed", reason: "Not saved" }, edit: enabled },
      ],
      literals: { _tag: "Ready", notice: "Review both edits", refused: [{ name: "border", where: ".button", reason: "No source map" }], literals: [{ id: "padding", property: "padding", value: "8px", selector: ".button", source: { file: "src/Button.css", line: 6 }, homes: [{ id: "root", label: ":root · Button.css:1" }], draft: { _tag: "Editing", name: "--button-padding", home: "root", preview: "Adds the token and replaces the literal", problem: "", create: enabled } }] },
    },
    checks: { _tag: "Closed" }, calibration: { _tag: "Open", pxPerMm: DEFAULT_PX_PER_MM, calibrated: false }, workspace: { _tag: "None" },
  } satisfies ChromeView)
}

/** Local inputs exercise the shared Send policy. No storage, selector resolution or agent is simulated. */
export function markupView(state: "empty" | "ready" | "lost" | "blocked" | "sending" | "failed" = "ready"): ChromeView {
  const ready = readyView()
  const sources = [{ take: "6", created: 1234 }, { take: "7", created: 5678 }]
  const marks: DraftMarkView[] = state === "empty" ? [] : [
    { id: "mark-6-a", letter: "A", name: "6A", note: "Keep this spacing", kind: "Point", rect: { x: 20, y: 30, width: 40, height: 20 }, location: state === "lost" ? { _tag: "Lost", reason: "Element not found. Re-place or remove 6A." } : { _tag: "Located" }, previewLabel: "Page · Menu open", deviceLabel: device.name, edit: enabled, remove: enabled, replace: enabled, references: [] },
    { id: "mark-7-a", letter: "A", name: "7A", note: "Reduce this area", kind: "Region", rect: { x: 60, y: 80, width: 100, height: 60 }, location: { _tag: "Located" }, previewLabel: "Page · Menu open", deviceLabel: device.name, edit: enabled, remove: enabled, replace: enabled, references: [] },
  ]
  const plan = planSend(marks.map((mark, index) => ({ id: mark.id, name: mark.name, note: mark.note, source: sources[index]!, location: mark.location })), sources.map(source => ({ ...source, kind: "Experiment", run: { _tag: state === "blocked" && source.take === "7" ? "Running" : "Idle" } })))
  const availability: Availability = plan._tag === "Ready" ? enabled : { _tag: "Disabled", reason: plan._tag === "Empty" ? "Add a mark first" : plan.reasons.join(" ") }
  const sending = state === "sending"
  const draftMarks = marks.map(mark => sending ? { ...mark, edit: blocked, remove: blocked, replace: blocked } : mark)
  const markup: MarkupView = {
    _tag: "Ready", revision: 4, mode: { _tag: state === "ready" ? "Marking" : "Off" }, draftOpen: true,
    groups: plan.groups.map(group => ({ source: group.source, label: `Take ${group.source.take}`, marks: draftMarks.filter(mark => group.marks.includes(mark.id)), decision: group.reasons.length ? { _tag: "Blocked", reasons: group.reasons } : { _tag: "Ready" }, outcome: { _tag: "NewTake" as const, label: "Send makes a new take." } })),
    editor: !marks.length || sending ? { _tag: "Closed" } : { _tag: "Open", id: marks[0]!.id, name: marks[0]!.name, note: marks[0]!.note, edit: enabled, references: [] },
    send: sending ? { _tag: "Sending", label: "Sending 2 new takes…" } : state === "failed" ? { _tag: "Failed", label: plan.label, reason: "Send failed before any take started. Draft retained.", availability } : { _tag: "Idle", label: plan.label, availability },
  }
  return { ...ready, markup, canvas: { _tag: "Frames", mode: "Takes", title: "Button", frames: [
    { ...frame, key: "real", take: null, label: "Original", src: "/frame", selected: false, markable: enabled },
    ...sources.map(source => ({ ...frame, key: `${source.take}@${source.created}`, take: source.take, src: `/frame?take=${source.take}`, label: `Take ${source.take}`, run: { _tag: state === "blocked" && source.take === "7" ? "Running" as const : "Idle" as const }, marks: draftMarks.filter(mark => mark.name.startsWith(source.take)), markable: sending ? blocked : enabled })),
  ], chains: sources.map(source => ({ id: `${source.take}@${source.created}`, shown: `${source.take}@${source.created}`, parent: null, take: source.take, label: source.take, history: { _tag: "None" as const }, flag: { _tag: "Current" as const }, solo: "Shown" as const })) } }
}

/**
 * Phase 6 references through the shared Send policy: 6A points to 7A and 0A,
 * so take 7 makes no take; 6 makes one and so does the original's unnamed 0B.
 * The note on 6A is open with every mark it can point to.
 */
export function referencesView(): ChromeView {
  const ready = readyView()
  const original = { take: "0", created: 0 }, six = { take: "6", created: 1234 }, seven = { take: "7", created: 5678 }
  const base = { kind: "Point" as const, location: { _tag: "Located" as const }, previewLabel: "Page · Menu open", deviceLabel: device.name, edit: enabled, remove: enabled, replace: enabled }
  const rows = [
    { source: six, mark: { ...base, id: "mark-6-a", letter: "A", name: "6A", note: "Use 7A here, and restore 0A", rect: { x: 20, y: 30, width: 0, height: 0 } } },
    { source: seven, mark: { ...base, id: "mark-7-a", letter: "A", name: "7A", note: "This spacing", rect: { x: 60, y: 80, width: 0, height: 0 } } },
    { source: original, mark: { ...base, id: "mark-0-a", letter: "A", name: "0A", note: "", rect: { x: 10, y: 10, width: 0, height: 0 } } },
    { source: original, mark: { ...base, id: "mark-0-b", letter: "B", name: "0B", note: "Too loud", rect: { x: 40, y: 12, width: 0, height: 0 } } },
  ]
  const names = rows.map(row => row.mark.name)
  const marks: DraftMarkView[] = rows.map(row => ({ ...row.mark, references: referencesIn(row.mark.note, row.source.take, names) }))
  const plan = planSend(rows.map(row => ({ id: row.mark.id, name: row.mark.name, note: row.mark.note, source: row.source, location: row.mark.location })), [six, seven].map(source => ({ ...source, kind: "Experiment" as const, run: { _tag: "Idle" as const } })))
  const labelOf = (source: { take: string }) => source.take === "0" ? "Original · the real files" : `Take ${source.take}`
  const outcome = (group: typeof plan.groups[number]): MarkupOutcome => group.outcome._tag === "PointedTo" ? { _tag: "PointedTo", label: "Pointed to by 6A; makes no take." }
    : { _tag: "NewTake", label: "Send makes a new take." }
  const crop = (take: string | null, rect: { x: number; y: number }) => ({ src: `/frame${take ? `?take=${take}` : ""}`, viewport: { width: device.cssWidth, height: device.cssHeight }, rect: { ...rect, width: 0, height: 0 } })
  const markup: MarkupView = {
    _tag: "Ready", revision: 9, mode: { _tag: "Off" }, draftOpen: true,
    groups: plan.groups.map(group => ({ source: group.source, label: labelOf(group.source), marks: marks.filter(mark => group.marks.includes(mark.id)), decision: { _tag: "Ready" }, outcome: outcome(group) })),
    editor: { _tag: "Open", id: "mark-6-a", name: "6A", note: rows[0]!.mark.note, edit: enabled, references: [
      { id: "mark-7-a", name: "7A", note: "This spacing", label: "Take 7 · Quiet button", crop: crop("7", { x: 60, y: 80 }) },
      { id: "mark-0-a", name: "0A", note: "", label: "Original · Page · Menu open", crop: crop(null, { x: 10, y: 10 }) },
      { id: "mark-0-b", name: "0B", note: "Too loud", label: "Original · Page · Menu open", crop: null },
    ] },
    send: { _tag: "Idle", label: plan.label, availability: plan._tag === "Ready" ? enabled : blocked },
  }
  const pinsOf = (take: string) => marks.filter(mark => mark.name.startsWith(take)).map(({ id, letter, kind, rect, location }) => ({ id, letter, kind, rect, location }))
  return { ...ready, markup, composer: { ...ready.composer, marks: { _tag: "None" } }, canvas: { _tag: "Frames", mode: "Takes", title: "Button", frames: [
    { ...frame, key: "real", take: null, label: "Original", src: "/frame", selected: false, markable: enabled, marks: pinsOf("0") },
    ...[six, seven].map(source => ({ ...frame, key: `${source.take}@${source.created}`, take: source.take, src: `/frame?take=${source.take}`, label: `Take ${source.take}`, marks: pinsOf(source.take), markable: enabled })),
  ], chains: [six, seven].map(source => ({ id: `${source.take}@${source.created}`, shown: `${source.take}@${source.created}`, parent: null, take: source.take, label: source.take, history: { _tag: "None" as const }, flag: { _tag: "Current" as const }, solo: "Shown" as const })) } }
}

/**
 * Phase 5 chains through the shared chain policy: take 6 from 1 across a
 * discarded 4, take 5 from 2, and take 3 alone, made before take 8 was
 * accepted. `history` opens every chain's history.
 */
export function chainsView(history: "folded" | "open" = "folded"): ChromeView {
  const ready = readyView()
  const at = (take: string, created: number) => ({ take, created })
  const root = (take: string, created: number): ChainTake => ({ ...at(take, created), part: subject.part, state: subject.state, files: ["src/Button.css"] })
  const one = root("1", 100), two = root("2", 200), three = root("3", 300)
  const six: ChainTake = { ...root("6", 600), chain: at("1", 100), lineage: [at("1", 100), at("4", 400)] }
  const five: ChainTake = { ...root("5", 500), chain: at("2", 200), lineage: [at("2", 200)] }
  const takes = [one, two, three, five, six]
  const accepted: AcceptRecord[] = [{ ...at("8", 700), part: subject.part, state: subject.state, files: ["src/Button.tsx"], at: 750 }]
  const flagOf = (take: ChainTake): AcceptFlag => {
    const flag = acceptFlag(take, accepted), words = flagWords(flag)
    return flag._tag === "Before" && words ? { _tag: "Before", take: flag.take, ...words } : { _tag: "Current" }
  }
  const key = (identity: { take: string; created: number }) => `${identity.take}@${identity.created}`
  const chains = planChains(takes, at("6", 600))
  const frames: FrameView[] = [{ ...frame, key: "real", take: null, label: "Original", src: "/frame", selected: false, markable: enabled }]
  const views: ChainView[] = chains.map(chain => {
    for (const identity of [chain.parent, chain.shown]) if (identity) frames.push({ ...frame, key: key(identity), take: identity.take, src: `/frame?take=${identity.take}`, label: `Take ${identity.take}`, selected: identity.take === "6" })
    const steps: ChainStepView[] = chain.steps.map(step => step.present ? { _tag: "Present", take: step.take, label: `Take ${step.take}`, selected: step.take === chain.shown.take } : { _tag: "Discarded", take: step.take, label: `Take ${step.take}, discarded` })
    return {
      id: chain.id, shown: key(chain.shown), parent: chain.parent ? key(chain.parent) : null, take: chain.shown.take, label: lineageLabel(chain),
      history: chain.steps.length < 2 ? { _tag: "None" } : history === "open" ? { _tag: "Open", label: historyLabel(chain.steps.length), steps } : { _tag: "Folded", label: historyLabel(chain.steps.length) },
      flag: flagOf(takes.find(take => take.take === chain.shown.take)!), solo: "Shown",
    }
  })
  const focused: TakeSummary = { ...take, id: "6", lineage: lineageLabel(chains[0]!), flag: flagOf(six) }
  return { ...ready, focusedTake: focused, record: ready.record._tag === "Open" ? { ...ready.record, take: focused } : ready.record, canvas: { _tag: "Frames", mode: "Takes", title: "Button", frames, chains: views } }
}

/** Every part's states unfolded, so their pins show. */
const expanded = (view: ChromeView): ChromeView => ({ ...view, navigation: { ...view.navigation, parts: view.navigation.parts.map(part => ({ ...part, expanded: true })) } })
export function contractViews(): Record<string, ChromeView> {
  const ready = readyView()
  const runningTake: TakeSummary = { ...take, run: { _tag: "Running" }, accept: blocked, stop: enabled, prepareAlternate: blocked }
  const running: ChromeView = { ...ready, focusedTake: runningTake, record: { _tag: "Open", take: runningTake, log: [], emptyLogMessage: "Working…", integration: { _tag: "None" } }, code: ready.code._tag === "Ready" ? { ...ready.code, mode: { _tag: "Watching", original: null }, stop: enabled } : ready.code }
  const alternate: ChromeView = { ...ready, focusedTake: { ...take, kind: "Alternate", accept: blocked }, record: { _tag: "Open", take: { ...take, kind: "Alternate" }, log: [], emptyLogMessage: "", integration: {
    _tag: "Review", sourceTake: "1", review: { revision: "review-r1", proposal: { strategy: "variant", summary: "Add a quiet variant", shared: "Same click behavior", preserved: "Existing callers stay unchanged", usage: '<Button tone="quiet" />', preview }, files: [{ path: "src/Button.tsx", before: "const x = 1", after: "const x = 2" }], checks: { _tag: "Passed", summary: "Originals preserved; alternate visible" } }, refresh: enabled, check: enabled, apply: blocked, behaviorReviewed: false, notices: [],
  } } }
  const checks: ChromeView = { ...ready, checks: { _tag: "Open", targetLabel: "Button · Real files", runSelected: enabled, runAll: enabled, notices: [], run: {
    _tag: "Ready", id: "run-1", badge: { status: "Review", label: "Needs review", detail: "Accepted is not a clean pass" }, stale: false, summary: "One state on one device", coverage: "Declared states only", runDetail: "Completed at source generation 1", reportUrl: "/report.json",
    rows: [{ index: 0, part: subject.part, state: subject.state, device: device.id, take: null, badge: { status: "Review", label: "Review", detail: "Two matching renders" }, findings: [{ id: "spill", label: "Content outside the screen", status: "Review", detail: "One expected edge" }], authored: [{ id: "click", label: "Click opens menu", status: "Passed", detail: "Browser input succeeded", image: { key: "authored-0", kind: "authored", url: pixel, label: "Interaction evidence", caption: "Not a baseline" } }], provenance: "Checks declared in real files", authoredSummary: "Only this named assertion", images: [{ key: "first", kind: "first", url: pixel, label: "First render", caption: "Saved evidence" }, { key: "repeat", kind: "repeat", url: pixel, label: "Repeat render", caption: "Saved evidence" }], approval: enabled, reviewed: false, approved: false, approvalNote: "Visual intent only" }],
  } } }
  return {
    ready, running, alternate, checks,
    markEmpty: markupView("empty"), markDraft: markupView("ready"), markLost: markupView("lost"),
    markBlocked: markupView("blocked"), markSending: markupView("sending"), markFailed: markupView("failed"),
    connecting: { ...ready, connection: { _tag: "Connecting" }, canvas: { _tag: "Empty", message: "Connecting to Vite" }, composer: { ...ready.composer, agent: { _tag: "Connecting" }, start: blocked } },
    chainPairs: chainsView("folded"), chainHistory: chainsView("open"),
    references: referencesView(),
    // Decision 45: a board with its questions open and an idea focused, and one that waits for its question.
    workspaceBoard: expanded(workspaceScene(ready, WORKSPACE_SCENES.workspaceBoard)),
    workspaceFrame: workspaceScene(ready, WORKSPACE_SCENES.workspaceFrame),
    failed: { ...ready, connection: { _tag: "Unreachable", reason: "Vite is not reachable" }, canvas: { _tag: "Frames", mode: "One", title: "Button", chains: [], frames: [{ ...frame, verdict: { _tag: "Failed" }, problems: [{ kind: "error", title: "Part threw", detail: "Source stack" }] }] }, code: { _tag: "Failed", reason: "Editor unavailable", retry: enabled }, composer: { ...ready.composer, agent: { _tag: "Failed", reason: "Agent unavailable", hint: "Check the model configuration" }, edit: blocked, start: blocked } },
    empty: { ...ready, selection: { _tag: "None" }, canvas: { _tag: "Empty", message: "Pick a part" }, composer: { ...ready.composer, agent: { _tag: "Off", hint: "Set up an agent" }, edit: blocked, start: blocked }, focusedTake: null, record: { _tag: "Closed" }, code: { _tag: "Empty", message: "Pick a part to see code" }, knobs: { _tag: "Idle", message: "Pick a part to see knobs" }, calibration: { _tag: "Closed" } },
    planning: { ...ready, plan: { _tag: "Planning", count: 3, message: "Planning 3 takes…" }, composer: { ...ready.composer, edit: blocked, attach: blocked } },
    loading: { ...ready, code: { _tag: "Loading", message: "Loading editor" }, knobs: { _tag: "Finding", target: "Real files" }, checks: { _tag: "Open", targetLabel: "Button", runSelected: blocked, runAll: blocked, notices: [], run: { _tag: "Loading" } } },
    checksRunning: { ...checks, checks: { _tag: "Open", targetLabel: "Button", runSelected: blocked, runAll: blocked, notices: [], run: { _tag: "Running", id: "run-2", progress: "Rendering 1 of 2", stop: enabled } } },
  }
}
