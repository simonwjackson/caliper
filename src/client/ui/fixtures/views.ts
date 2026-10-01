/**
 * Local input fixtures for the Darkroom chrome (decision 18): explicit data
 * for every region state the gallery and the part files show. They are not a
 * server snapshot and do not replace core's `toChromeView`. Each call returns
 * fresh values, so a scenario can update its copy without touching another.
 *
 * The data follows the mockup (Pico's Game Detail on the RG353M), so a render
 * can be set beside `docs/design/mockups/out/`. Three states the mockup does
 * not draw are here too: a running take with Stop, an agent that failed to
 * load, and an agent that is off.
 *
 * Takes on the canvas are chains built by the shared chain policy from take
 * records with their lineage and an accept log (`./chains`), as core builds
 * them. Three families of records: the mockup's (6 from 1 across a discarded
 * 4, 5 from 2, and 3 alone, flagged by an accept of the Button), a branch on
 * take 1, and a part after an accept, where every chain is flagged.
 */
import type {
  Availability, ChecksView, ChromeView, CodeView, FrameView, KnobView, LogEntry, NavPart, NavState, TakeSummary,
} from "../contract"
import { HANDHELD_DEVICES } from "../../device-frame.js"
import { identityKey } from "../../../takes/chains.js"
import type { AcceptRecord, ChainTake, TakeIdentity } from "../../../takes/chains.js"
import { PICO_GAME_DETAIL } from "./pico"
import { sourceOf, withMarkup } from "./markup"
import type { LocalMark, MarkupState } from "./markup"
import { chainFacts, takeKey, withChains } from "./chains"
import type { ChainChoices, ChainFamily } from "./chains"

export const enabled: Availability = { _tag: "Enabled" }
const blocked = (reason: string): Availability => ({ _tag: "Disabled", reason })

const PART = "src/pages/PicoGameDetail.page.part.tsx"
const ref = (state: string) => ({ part: PART, state })
const DEFAULT = ref("default")
// The fixture project is Pico, which lists the two handhelds in its vite.config.
const rg353m = HANDHELD_DEVICES[0]!
const odin = HANDHELD_DEVICES[1]!

/**
 * A frame document: the Pico render filling the device's CSS viewport. A tap
 * counts in `data-taps` on the body, so a gate can prove an update kept the
 * frame's reached state. Data URLs keep the fixture free of any server route.
 */
export function frameSource(filter = "none", taps = true): string {
  const script = taps ? "<script>document.addEventListener('pointerdown',()=>{document.body.dataset.taps=String(Number(document.body.dataset.taps||0)+1)})</script>" : ""
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Game Detail</title><style>html,body{margin:0;height:100%;background:#000}img{display:block;width:100vw;height:100vh;object-fit:contain;image-rendering:pixelated;filter:${filter}}</style></head><body data-taps="0"><img alt="" src="${PICO_GAME_DETAIL}">${script}</body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}
const FILTERS: Record<string, string> = {
  real: "none", "1": "none", "2": "hue-rotate(35deg)", "3": "contrast(1.2) brightness(.75)", "5": "hue-rotate(-30deg) brightness(.9)", "6": "hue-rotate(160deg)", "7": "hue-rotate(250deg) saturate(.85)",
  "no-art": "saturate(.6) brightness(.85)", locations: "hue-rotate(35deg)", choose: "hue-rotate(-30deg) brightness(.9)", removal: "contrast(1.2) brightness(.75)",
}
const TAKE_NAMES: Record<string, string> = {
  "1": "Cover art two thirds wide", "2": "Stats in one row", "3": "Actions as chips", "5": "Stats in one row, larger", "6": "Cover at half, title beside it",
  "7": "Cover two thirds, title below",
}

function frame(take: string | null, overrides: Partial<FrameView> = {}): FrameView {
  const id = take ?? "real"
  return {
    key: take ? `${take}@2026-09-29T13:${take.padStart(2, "0")}` : "real", label: take ? TAKE_NAMES[take] ?? `Take ${take}` : "Real files",
    title: take ? `Take ${take} · ${TAKE_NAMES[take]}` : "The real files", src: frameSource(FILTERS[id]), subject: DEFAULT, preview: DEFAULT,
    take, selected: take === "6", run: { _tag: "Idle" }, verdict: { _tag: "Rendered" }, problems: [], marks: [],
    // Phase 6: the real files take marks too (plan decision 8).
    markable: enabled, ...overrides,
  }
}

const GAME_DETAIL_FILES = ["src/pages/PicoGameDetail.css", "src/pages/PicoGameDetail.tsx"]
/** Take N of a family was made at minute N of the family's hour, on the fixtures' day. */
const takeAt = (hour: number) => (take: string): TakeIdentity => ({ take, created: Date.UTC(2026, 8, 29, hour, Number(take)) })
/** A take record of Game Detail. `from` is its lineage, the chain's first take to its parent, as take numbers. */
const records = (at: (take: string) => TakeIdentity) => (take: string, from: readonly string[] = [], files: readonly string[] = GAME_DETAIL_FILES): ChainTake => ({
  ...at(take), part: PART, state: "default", files: [...files], ...(from[0] ? { chain: at(from[0]), lineage: from.map(at) } : {}),
})
const family = (takes: readonly ChainTake[], accepted: readonly AcceptRecord[]): ChainFamily =>
  ({ takes, accepted, frame: take => frame(take.take, { key: takeKey(take) }) })

const m = takeAt(13), mockup = records(m)
/**
 * The mockup's takes: 6 from 1 across a discarded 4, 5 from 2, and 3 alone.
 * Take 8 of the Button changed PicoButton.css, which take 3 also changes, and
 * was accepted after 3 was made, so 3 is flagged; 5 and 6 are newer.
 */
export const MOCKUP: ChainFamily = family(
  [mockup("1"), mockup("2"), mockup("3", [], ["src/pages/PicoGameDetail.tsx", "src/atoms/PicoButton.css"]), mockup("5", ["2"]), mockup("6", ["1", "4"])],
  [{ ...m("8"), part: "src/atoms/PicoButton.atom.part.tsx", state: "default", files: ["src/atoms/PicoButton.css"], at: Date.UTC(2026, 8, 29, 13, 9) }],
)
const b = takeAt(14), branched = records(b)
/** The mockup's takes an hour later, with a second pass on take 1: take 7 branches the chain beside 6. */
export const BRANCHED: ChainFamily = family(
  [branched("1"), branched("2"), branched("3", [], ["src/pages/PicoGameDetail.tsx", "src/atoms/PicoButton.css"]), branched("5", ["2"]), branched("6", ["1", "4"]), branched("7", ["1"])],
  [{ ...b("8"), part: "src/atoms/PicoButton.atom.part.tsx", state: "default", files: ["src/atoms/PicoButton.css"], at: Date.UTC(2026, 8, 29, 14, 9) }],
)
const a = takeAt(15), after = records(a)
/**
 * After an accept: take 8's chain of Game Detail was accepted and removed. The
 * chains left, 1, 2 and 7 from 3 across a discarded 5, were made before it and
 * share its part, so each is flagged "made before take 8 was accepted".
 */
export const ACCEPTED: ChainFamily = family(
  [after("1"), after("2"), after("3"), after("7", ["3", "5"])],
  [{ ...a("8"), part: PART, state: "default", files: ["src/pages/PicoGameDetail.css"], at: Date.UTC(2026, 8, 29, 15, 9) }],
)
/** Every family, for the scenario to find the one a view shows. */
export const CHAIN_FAMILIES: readonly ChainFamily[] = [MOCKUP, BRANCHED, ACCEPTED]

function summary(id: string, overrides: Partial<TakeSummary> = {}): TakeSummary {
  const known = MOCKUP.takes.find(take => take.take === id)
  return {
    id, name: TAKE_NAMES[id] ?? `Take ${id}`, subjectLabel: "Default", deviceLabel: rg353m.name,
    createdLabel: "",
    run: { _tag: "Idle" }, files: ["src/pages/PicoGameDetail.css", "src/pages/PicoGameDetail.tsx"], nameIssue: "",
    direction: id === "6" ? { title: "Cover at half, title beside it", brief: "Cover and title share the top half side by side; the actions move to one row under both." } : null,
    unavailableReason: "", accept: enabled, discard: enabled, stop: blocked("The take is not running"), prepareAlternate: enabled, kind: "Experiment",
    ...(known ? chainFacts(MOCKUP, known) : { lineage: "", flag: { _tag: "Current" } }),
    ...overrides,
  }
}

function states(count: number, labels: readonly string[] = []): NavState[] {
  return Array.from({ length: count }, (_, index) => {
    const label = labels[index] ?? (index === 0 ? "Default" : `State ${index + 1}`)
    return { ref: { part: "src/x.part.tsx", state: index === 0 ? "default" : `S${index}` }, label, site: "", selected: false, takes: [], comparing: false }
  })
}
function part(name: string, file: string, layer: NavPart["layer"], count: number, overrides: Partial<NavPart> = {}): NavPart {
  const list = states(count).map(state => ({ ...state, ref: { part: file, state: state.ref.state } }))
  return { file, name, note: "", layer, layerSite: "filename suffix", selected: false, expanded: false, states: list, ...overrides }
}

const gameDetailStates = (takes: readonly string[], selected: string): NavState[] => [
  { ref: DEFAULT, label: "Default", site: `${PART}:12`, selected: true, comparing: true, badge: { status: "Passed", label: "Passed", detail: "Render and image checks passed" },
    takes: takes.map(id => ({ id, label: `${id} · ${TAKE_NAMES[id]}`, selected: id === selected })) },
  { ref: ref("NoArtOrHistory"), label: "No art or history", site: `${PART}:30`, selected: false, comparing: false, takes: [] },
  { ref: ref("MultipleLocations"), label: "Multiple locations", site: `${PART}:34`, selected: false, comparing: false, takes: [] },
  { ref: ref("ChooseLocation"), label: "Choose location", site: `${PART}:38`, selected: false, comparing: false, takes: [] },
  { ref: ref("ConfirmRemoval"), label: "Confirm removal", site: `${PART}:41`, selected: false, comparing: false, badge: { status: "Failed", label: "Failed", detail: "Threw while rendering" }, takes: [] },
]

const LOG: LogEntry[] = [
  { _tag: "User", text: "Give the cover more room and let the title breathe.", images: [] },
  { _tag: "Tool", name: "read", subject: "PicoGameDetail.tsx", outcome: "Done", detail: "" },
  { _tag: "Tool", name: "read", subject: "PicoGameDetail.css", outcome: "Done", detail: "" },
  { _tag: "Assistant", text: "I will put the cover and the title side by side and move the actions under both, so the title keeps its size." },
  { _tag: "Tool", name: "edit", subject: "PicoGameDetail.css", outcome: "Done", detail: "+8 −3" },
  { _tag: "Tool", name: "edit", subject: "PicoGameDetail.tsx", outcome: "Done", detail: "+3 −1" },
  { _tag: "Tool", name: "render", subject: "Default on RG353M", outcome: "Done", detail: "fits, no errors" },
  { _tag: "Assistant", text: "Done. The title now sits beside the cover at its old size; nothing reaches past the screen." },
]

/** The takes state of the mockup: the real files, then each chain: 6 from 1, 5 from 2, and 3 alone and flagged. Take 6 focused. */
export function takesView(): ChromeView { return takesWith(MOCKUP, "6") }

/** A Takes canvas of one family's chains, with one take selected and focused. */
function takesWith(family: ChainFamily, selected: string, choices: Partial<Omit<ChainChoices, "selected">> = {}): ChromeView {
  const picked = family.takes.find(item => item.take === selected) ?? null
  const take = summary(selected, picked ? chainFacts(family, picked) : {})
  const view: ChromeView = {
    connection: { _tag: "Ready" },
    selection: { _tag: "State", subject: DEFAULT, preview: DEFAULT, label: "Default" },
    navigation: {
      project: "@korri/pico", filter: "", countLabel: "52 parts", emptyMessage: "",
      projects: { _tag: "Choices", choices: [
        { id: "2e5778d2b4c4", name: "@korri/pico", current: true, problem: "" },
        { id: "8d404a4ae70c", name: "@simonwjackson/caliper", current: false, problem: "" },
        { id: "08fdb36dffb7", name: "billing-portal", current: false, problem: "protocol 0, this app speaks 1" },
      ] },
      parts: [
        part("Game Detail", PART, "page", 5, { selected: true, expanded: true, states: gameDetailStates(family.takes.map(item => item.take), selected), note: "The game's page" }),
        part("Home", "src/pages/PicoHome.page.part.tsx", "page", 4), part("Find", "src/pages/PicoFind.page.part.tsx", "page", 12),
        part("Gameplay Overlay", "src/pages/PicoGameplayOverlay.page.part.tsx", "page", 3), part("Runner Picker", "src/pages/PicoRunnerPicker.page.part.tsx", "page", 2),
        part("Settings", "src/pages/PicoSettings.page.part.tsx", "page", 6), part("Settings Panel", "src/pages/PicoSettingsPanel.page.part.tsx", "page", 3),
        part("Game Overlay", "src/templates/PicoGameOverlay.template.part.tsx", "template", 2), part("Panel Screen", "src/templates/PicoPanelScreen.template.part.tsx", "template", 2),
        part("Screen Shell", "src/templates/PicoScreenShell.template.part.tsx", "template", 1),
        part("Shelf", "src/organisms/PicoShelf.organism.part.tsx", "organism", 3), part("Keyboard", "src/organisms/PicoKeyboard.organism.part.tsx", "organism", 2),
        part("Identity Dialog", "src/organisms/PicoIdentityDialog.organism.part.tsx", "organism", 4),
      ],
      scenario: {
        _tag: "Selected", subject: DEFAULT, editingLabel: "Editing Game Detail · Default",
        choices: [{ key: "isolated", label: "Isolated", context: null }, { key: "home", label: "Composed: Home shelf", context: { part: "src/pages/PicoHome.page.part.tsx", state: "default" } }],
        chosen: "isolated", note: "", whole: null, children: [],
      },
      unavailable: [],
      setup: [
        { label: "Entry", status: "Derived", values: ["src/main.tsx"], provenance: "index.html:12", problems: [] },
        { label: "CSS", status: "Derived", values: ["src/styles/pico-tokens.css", "src/styles/pico-base.css"], provenance: "src/main.tsx:3", problems: [] },
        { label: "Wrapper", status: "Derived", values: ["PicoApp"], provenance: "src/main.tsx:9", problems: [] },
      ],
      setupProblems: [],
    },
    devices: HANDHELD_DEVICES, device: rg353m, pxPerMm: 3.875, calibrated: true,
    tools: { active: "takes", navOpen: true, codeOpen: false, side: "closed", codeShare: 0.46 },
    canvas: { _tag: "Frames", mode: "Takes", title: "Game Detail", frames: [frame(null, { selected: false })], chains: [] },
    plan: { _tag: "None" },
    composer: {
      prompt: "", placeholder: "Describe a change to Game Detail", edit: enabled, attach: enabled, attachments: [], count: 1,
      start: blocked("Describe a change first"), startLabel: "New take",
      follow: { take: selected, label: `Send to take ${selected}`, availability: blocked("Describe a change first") }, marks: { _tag: "None" }, notices: [],
      agent: { _tag: "Ready", model: "qwen3-coder", baseUrl: "http://127.0.0.1:11434/v1", reasoning: "medium", api: "chat-completions", baseUrlFrom: "~/.config/caliper/config.json", keyFrom: "CALIPER_AGENT_API_KEY" },
      skills: { skills: [
        { name: "pico-design", description: "Pico's palette, pixel grid and type", scope: "project", location: ".agents/skills/pico-design/SKILL.md" },
        { name: "frontend-design", description: "Visual direction and typography", scope: "user", location: "~/.agents/skills/frontend-design/SKILL.md" },
        { name: "intrinsic-design", description: "Layout as a function of the container", scope: "user", location: "~/.agents/skills/intrinsic-design/SKILL.md" },
      ], problems: [] },
    },
    markup: { _tag: "Unavailable", reason: "Take markup is not connected yet" },
    focusedTake: take, record: { _tag: "Closed" },
    code: { _tag: "Closed" }, knobs: { _tag: "Closed" }, checks: { _tag: "Closed" }, calibration: { _tag: "Closed" },
  }
  const chained = withChains(view, family, { selected: picked, open: choices.open ?? [], solo: choices.solo ?? {} })
  return structuredClone(withMarkup(chained, [], { revision: 1, mode: { _tag: "Off" }, draftOpen: false, editor: null }))
}

/** The view's canvas with each frame changed and its chains kept. */
function mapFrames(view: ChromeView, change: (frame: FrameView) => FrameView): ChromeView["canvas"] {
  return view.canvas._tag === "Frames" ? { ...view.canvas, frames: view.canvas.frames.map(change) } : view.canvas
}

/** A branch and an open history: take 7 is a second pass on take 1, beside 6; the strip shows 1, 4 struck, 6 and 7. */
export function chainHistoryView(): ChromeView {
  return takesWith(BRANCHED, "6", { open: [identityKey(b("1"))] })
}

/**
 * After take 8 was accepted: every chain left is flagged. Take 7 from 3 across
 * a discarded 5 is focused with its record open, and its pair shows the parent
 * when it does not fit, a choice core keeps (planner choice 19).
 */
export function chainsAcceptedView(): ChromeView {
  const view = takesWith(ACCEPTED, "7", { solo: { [identityKey(a("3"))]: "Parent" } })
  const take = view.focusedTake ?? summary("7")
  const log: LogEntry[] = [
    { _tag: "User", text: "3A: Keep the chip shape, but put the chips in one row.", images: [] },
    { _tag: "Tool", name: "edit", subject: "PicoGameDetail.css", outcome: "Done", detail: "+4 −2" },
    { _tag: "Assistant", text: "The chips keep their shape and sit in one row under the title." },
  ]
  return { ...view, tools: { ...view.tools, side: "record" }, record: { _tag: "Open", take, log, emptyLogMessage: "", integration: { _tag: "None" } } }
}

/** The mockup's chains on the ODIN 2 PORTAL: a pair needs 1,249 px at true size, so a desk shows one frame of each chain. */
export function chainsOdinView(): ChromeView {
  return { ...takesView(), device: odin }
}

/** First run: the real files, the composer and one sentence. */
export function emptyView(): ChromeView {
  const view = takesView()
  const nav = view.navigation.parts.map(item => item.file === PART ? { ...item, states: item.states.map(state => ({ ...state, takes: [], comparing: false, badge: undefined })) } : item)
  return {
    ...view, navigation: { ...view.navigation, parts: nav },
    canvas: { _tag: "Frames", mode: "One", title: "Game Detail", frames: [frame(null, { selected: false })], chains: [] },
    composer: { ...view.composer, follow: null }, focusedTake: null,
  }
}

/** Nothing selected yet. */
export function noneView(): ChromeView {
  const view = emptyView()
  return {
    ...view, selection: { _tag: "None" }, canvas: { _tag: "Empty", message: "Pick a part from the list to see it at true size." },
    navigation: { ...view.navigation, scenario: { _tag: "None" }, parts: view.navigation.parts.map(item => ({ ...item, selected: false, expanded: false })) },
    composer: { ...view.composer, edit: blocked("Pick a part first"), attach: blocked("Pick a part first"), start: blocked("Pick a part first") },
  }
}

/** A typed prompt with an image, ready to start: the mockup's menu state before the menu opens. */
export function promptView(): ChromeView {
  const view = takesView()
  return {
    ...view,
    composer: {
      ...view.composer, prompt: "Match the attached screenshot's spacing", start: enabled,
      attachments: [{ id: "image-1", name: "reference.png", url: PICO_GAME_DETAIL, remove: enabled }],
      follow: { take: "6", label: "Send to take 6", availability: enabled },
    },
  }
}

/**
 * Three takes being planned: blank slots where the takes will appear, and one
 * status line in the bar. The takes start as soon as the planner answers.
 */
export function planningView(): ChromeView {
  const view = takesView()
  const prompt = "Give the cover more room and let the title breathe."
  return {
    ...view, focusedTake: null,
    canvas: { _tag: "Frames", mode: "One", title: "Game Detail", frames: [frame(null, { selected: false })], chains: [] },
    plan: { _tag: "Planning", count: 3, message: "Planning 3 takes…" },
    composer: { ...view.composer, prompt, count: 3, edit: blocked("Takes are being planned"), attach: blocked("Takes are being planned"), startLabel: "3 new takes", follow: null },
  }
}

/** Take 6's record open in the side panel. */
export function logView(): ChromeView {
  const view = takesView()
  const take = view.focusedTake ?? summary("6")
  return {
    ...view, tools: { ...view.tools, side: "record" },
    record: { _tag: "Open", take, log: LOG, emptyLogMessage: "No conversation since Vite started.", integration: { _tag: "None" } },
  }
}

/** Not drawn in the mockup: take 6's agent at work. Accept waits; Stop is in reach in three places. */
export function runningView(): ChromeView {
  const view = logView()
  const take = summary("6", { run: { _tag: "Running" }, accept: blocked("Wait for the agent, or stop it"), stop: enabled, prepareAlternate: blocked("Wait for the agent, or stop it") })
  const log: LogEntry[] = [
    ...LOG.slice(0, 5),
    { _tag: "Tool", name: "edit", subject: "PicoGameDetail.tsx", outcome: "Running", detail: "" },
  ]
  return {
    ...view, canvas: mapFrames(view, item => item.take === "6" ? { ...item, run: { _tag: "Running" } as const } : item), focusedTake: take,
    record: { _tag: "Open", take, log, emptyLogMessage: "Working…", integration: { _tag: "None" } },
    composer: { ...view.composer, follow: { take: "6", label: "Send to take 6", availability: blocked("Take 6 is still working") } },
  }
}

/** A take whose agent stopped with an error. */
export function failedTakeView(): ChromeView {
  const view = logView()
  const take = summary("6", { run: { _tag: "Failed", reason: "The model returned 529: overloaded. The take keeps its edits so far." } })
  return { ...view, canvas: mapFrames(view, item => item.take === "6" ? { ...item, run: take.run } : item), focusedTake: take, record: { _tag: "Open", take, log: LOG.slice(0, 4), emptyLogMessage: "", integration: { _tag: "None" } } }
}

/** Not drawn in the mockup: the agent failed to load. The failure shows in the bar, where the prompt is. */
export function agentFailedView(): ChromeView {
  const view = takesView()
  const reason = "Caliper could not reach http://127.0.0.1:11434/v1: connection refused."
  return {
    ...view, composer: {
      ...view.composer, prompt: "Give the cover more room", agent: { _tag: "Failed", reason, hint: "Start the model server, or set agent.baseUrl in ~/.config/caliper/config.json." },
      start: blocked("The agent did not load"), follow: { take: "6", label: "Send to take 6", availability: blocked("The agent did not load") },
    },
  }
}

/** No agent configured. Takes stay reviewable; only new prompts wait. */
export function agentOffView(): ChromeView {
  const view = takesView()
  return { ...view, composer: { ...view.composer, agent: { _tag: "Off", hint: "Set CALIPER_AGENT_API_KEY to make takes." }, start: blocked("No agent is set up"), follow: null } }
}

const PALETTE = ["#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8", "#ff004d", "#ffa300", "#ffec27", "#00e436", "#29adff", "#83769c", "#ff77a8", "#ffccaa"]
const PALETTE_NAMES = ["black", "navy", "maroon", "green", "brown", "slate", "silver", "white", "red", "orange", "yellow", "lime", "blue", "lilac", "pink", "peach"]
const paletteToken = (chosen: string) => ({ _tag: "Token" as const, chosen: `--pico-${chosen}`, color: true, options: PALETTE.map((value, index) => ({ name: `--pico-${PALETTE_NAMES[index]}`, value })) })
function knob(id: string, overrides: Partial<KnobView> & Pick<KnobView, "name" | "label" | "value" | "control">): KnobView {
  return { id, origin: "Property", where: ":root", source: { file: "src/styles/pico-tokens.css", line: 98 }, note: "", problems: [], write: { _tag: "Idle" }, edit: enabled, ...overrides }
}

/** The Knobs panel: registered, thresholds, what the part reads, literals. */
export function knobsView(): ChromeView {
  const view = emptyView()
  const knobs: KnobView[] = [
    knob("rows", { name: "--pico-pixel-rows", label: "Pixel rows", value: "352", note: "How many pixel rows the screen draws", control: { _tag: "Number", number: 352, unit: "", step: 10, min: 180, max: 720 } }),
    knob("min", { name: "--pico-pixel-min", label: "Pixel min", value: "2px", source: { file: "src/styles/pico-tokens.css", line: 102 }, control: { _tag: "Number", number: 2, unit: "px", step: 1, min: 1, max: 6 } }),
    knob("bg", { name: "--pico-bg", label: "Bg", value: "var(--pico-black)", source: { file: "src/styles/pico-tokens.css", line: 110 }, control: paletteToken("black") }),
    knob("accent", { name: "--pico-accent", label: "Accent", value: "var(--pico-pink)", source: { file: "src/styles/pico-tokens.css", line: 111 }, control: paletteToken("pink"), write: { _tag: "Saved" } }),
    knob("stage", { name: "@container", label: "pico-stage height <", value: "16em", origin: "Threshold", where: "pico-stage (height < 16em)", source: { file: "src/pages/PicoGameFacts.css", line: 27 }, control: { _tag: "Number", number: 16, unit: "em", step: 0.5, min: 0 } }),
    knob("launch", { name: "@container", label: "pico-launch height <", value: "22em", origin: "Threshold", where: "pico-launch (height < 22em)", source: { file: "src/pages/PicoLaunchStage.css", line: 118 }, control: { _tag: "Number", number: 22, unit: "em", step: 0.5, min: 0 }, write: { _tag: "Conflict", reason: "PicoLaunchStage.css changed on disk. Reload the frame, then try again." } }),
    knob("go", { name: "--pico-go", label: "Go", value: "var(--pico-yellow)", origin: "Plain", where: ".pico-game-detail", source: { file: "src/pages/PicoGameDetail.css", line: 8 }, control: paletteToken("yellow") }),
    knob("plate", { name: "--pico-plate", label: "Plate", value: "#1d2b53", origin: "Plain", where: ".pico-game-detail", source: { file: "src/pages/PicoGameDetail.css", line: 9 }, control: { _tag: "Color", hex: "#1d2b53" } }),
    knob("u", { name: "--pico-u", label: "U", value: "4px", origin: "Plain", where: ".pico-game-detail", source: { file: "src/pages/PicoGameDetail.css", line: 10 }, control: { _tag: "Number", number: 4, unit: "px", step: 1 } }),
    knob("shape", { name: "--pico-cart-shape", label: "Cart shape", value: "square", origin: "Property", source: { file: "src/styles/pico-tokens.css", line: 120 }, control: { _tag: "Choice", options: ["square", "round", "notched"] }, write: { _tag: "Failed", reason: "The write was refused: the file is outside the project." } }),
  ]
  return {
    ...view, tools: { ...view.tools, active: "knobs", side: "knobs" },
    knobs: {
      _tag: "Ready", target: "Game Detail, Default", knobs, problems: [],
      skipped: [{ name: "--pico-px", where: ":root", reason: "is computed with max()" }, { name: "--pico-cycle", where: "@keyframes pico-blink", reason: "is animated" }],
      literals: { _tag: "Ready", notice: "", refused: [{ name: "border: 0", where: ".pico-game-detail__cover", reason: "shows nothing at this size" }], literals: [
        { id: "gap", property: "gap", value: "6px", selector: ".pico-game-facts__row", source: { file: "src/pages/PicoGameFacts.css", line: 14 }, homes: [{ id: "facts", label: ".pico-game-facts · PicoGameFacts.css:3" }, { id: "root", label: ":root · pico-tokens.css:1" }],
          draft: { _tag: "Editing", name: "--pico-facts-row-gap", home: "facts", preview: "Adds --pico-facts-row-gap: 6px after line 7 of PicoGameFacts.css and uses var(--pico-facts-row-gap) at line 14.", problem: "", create: enabled } },
        { id: "radius", property: "border-radius", value: "2px", selector: ".pico-button", source: { file: "src/atoms/PicoButton.css", line: 6 }, homes: [{ id: "root", label: ":root · pico-tokens.css:1" }], draft: { _tag: "Closed" } },
      ] },
    },
  }
}

export function knobsFindingView(): ChromeView {
  const view = knobsView()
  return { ...view, knobs: { _tag: "Finding", target: "Game Detail, Default" } }
}

const CSS_REAL = `/* Cover on the left, facts on the right. */
.pico-game-detail {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
  gap: calc(var(--pico-u) * 2);
  container: pico-stage / size;
}

.pico-game-detail__cover {
  align-self: start;
  border: var(--pico-px) solid var(--pico-shell-tell);
}

/* Below 16em the facts stack under the cover. */
@container pico-stage (height < 16em) {
  .pico-game-detail { grid-template-columns: 1fr; }
}
`
const CSS_TAKE = CSS_REAL.replace("minmax(0, 3fr)", "minmax(0, 1fr)").replace("  align-self: start;\n", "  align-self: stretch;\n  display: grid;\n  place-items: center;\n")

function codeReady(overrides: Partial<Extract<CodeView, { _tag: "Ready" }>> = {}): CodeView {
  return {
    _tag: "Ready",
    files: [
      { file: PART, label: "PicoGameDetail.page.part.tsx", depth: 0, changed: false },
      { file: "src/pages/PicoGameDetail.tsx", label: "PicoGameDetail.tsx", depth: 1, changed: true, added: 3, removed: 1 },
      { file: "src/pages/PicoGameDetail.css", label: "PicoGameDetail.css", depth: 1, changed: true, added: 8, removed: 3 },
      { file: "src/pages/PicoGameFacts.tsx", label: "PicoGameFacts.tsx", depth: 2, changed: false },
      { file: "src/pages/PicoGameFacts.css", label: "PicoGameFacts.css", depth: 2, changed: false },
      { file: "src/atoms/PicoButton.tsx", label: "PicoButton.tsx", depth: 3, changed: false },
      { file: "src/styles/pico-tokens.css", label: "pico-tokens.css", depth: null, changed: true, added: 1, removed: 0 },
    ],
    tabs: [PART, "src/pages/PicoGameDetail.tsx", "src/pages/PicoGameDetail.css"], filter: "", selectedFile: "src/pages/PicoGameDetail.css",
    document: { file: "src/pages/PicoGameDetail.css", content: CSS_TAKE, original: CSS_REAL }, documentKey: "1@2026-09-29T13:01|src/pages/PicoGameDetail.css",
    mode: { _tag: "Take", original: CSS_REAL }, save: { _tag: "Saved", label: "Saved to take 1" }, notice: "", changes: 2, take: "1", stop: blocked("The take is not running"),
    lenses: [{ export: "default", label: "Default", current: true }, { export: "ConfirmRemoval", label: "Confirm removal", current: false }],
    ...overrides,
  }
}

/** The code pane under the stage, showing take 1's diff. */
export function codeView(): ChromeView {
  const view = emptyView()
  return { ...view, tools: { ...view.tools, active: "code", codeOpen: true }, code: codeReady() }
}

/** The code pane while take 6's agent edits: read-only, following the agent, with Stop. */
export function codeWatchingView(): ChromeView {
  const view = runningView()
  return {
    ...view, tools: { ...view.tools, active: "code", codeOpen: true, side: "closed" },
    code: codeReady({ take: "6", mode: { _tag: "Watching", original: CSS_REAL }, stop: enabled, save: { _tag: "Idle" }, notice: "Take 6's agent is editing. The pane follows its changes.", documentKey: "6@2026-09-29T13:06|src/pages/PicoGameDetail.css" }),
  }
}

export function codeLoadingView(): ChromeView {
  const view = codeView()
  return { ...view, code: { _tag: "Loading", message: "Loading the editor" } }
}
export function codeFailedView(): ChromeView {
  const view = codeView()
  return { ...view, code: { _tag: "Failed", reason: "The editor could not load: @codemirror/view 6.43.13 and 6.41.0 are both installed.", retry: enabled } }
}

const STATE_FRAMES = [
  ["default", "Default", "real"], ["NoArtOrHistory", "No art or history", "no-art"], ["MultipleLocations", "Multiple locations", "locations"],
  ["ChooseLocation", "Choose location", "choose"], ["ConfirmRemoval", "Confirm removal", "removal"],
] as const

/** All five states side by side at true size. */
export function gridView(): ChromeView {
  const view = emptyView()
  const frames = STATE_FRAMES.map(([state, label, filter], index) => ({
    ...frame(null, { key: `state:${state}`, label, title: `${label} · real files`, src: frameSource(FILTERS[filter]), subject: ref(state), preview: ref(state), selected: index === 0 }),
  }))
  const parts = view.navigation.parts.map(item => item.file === PART ? { ...item, states: item.states.map(state => ({ ...state, selected: false })) } : item)
  return { ...view, navigation: { ...view.navigation, parts }, selection: { _tag: "All", part: PART }, canvas: { _tag: "Frames", mode: "All", title: "Game Detail", frames, chains: [] }, focusedTake: null }
}

const STACK = `TypeError: Cannot read properties of undefined (reading 'title')
    at ConfirmRemoval (src/pages/PicoGameDetail.page.part.tsx:41:22)
    at renderWithHooks (node_modules/.vite/deps/react-dom_client.js:5908:24)
    at updateFunctionComponent (node_modules/.vite/deps/react-dom_client.js:7729:21)`

/** A part that throws: the frame carries the failure. */
export function errorView(): ChromeView {
  const view = emptyView()
  const failing = frame(null, {
    key: "state:ConfirmRemoval", label: "Real files", subject: ref("ConfirmRemoval"), preview: ref("ConfirmRemoval"), selected: false, verdict: { _tag: "Failed" },
    src: "data:text/html;charset=utf-8,%3C!doctype%20html%3E%3Cbody%20style%3D%22margin%3A0%3Bbackground%3A%23500a0a%3Bcolor%3A%23fff%3Bfont%3A14px%2F1.4%20system-ui%3Bpadding%3A16px%22%3E%3Cstrong%3Esrc%2Fpages%2FPicoGameDetail.page.part.tsx%20threw%20while%20rendering%3C%2Fstrong%3E%3Cpre%20style%3D%22white-space%3Apre-wrap%3Bfont%3A12px%2F1.45%20monospace%22%3ETypeError%3A%20Cannot%20read%20properties%20of%20undefined%20(reading%20'title')%0A%20%20at%20ConfirmRemoval%20(src%2Fpages%2FPicoGameDetail.page.part.tsx%3A41%3A22)%3C%2Fpre%3E%3C%2Fbody%3E",
    problems: [{ kind: "error", title: "Confirm removal: src/pages/PicoGameDetail.page.part.tsx threw while rendering", detail: STACK }],
  })
  const parts = view.navigation.parts.map(item => item.file === PART ? { ...item, states: item.states.map(state => ({ ...state, selected: state.ref.state === "ConfirmRemoval" })) } : item)
  return {
    ...view, navigation: { ...view.navigation, parts },
    selection: { _tag: "State", subject: ref("ConfirmRemoval"), preview: ref("ConfirmRemoval"), label: "Confirm removal" },
    canvas: { _tag: "Frames", mode: "One", title: "Game Detail", frames: [failing], chains: [] },
  }
}

/** The ODIN 2 PORTAL cannot fit at true size on a phone: the caption says it is scaled. */
export function odinView(): ChromeView {
  const view = emptyView()
  return { ...view, device: odin }
}

function checksOpen(run: Extract<ChecksView, { _tag: "Open" }>["run"]): Extract<ChecksView, { _tag: "Open" }> {
  return { _tag: "Open", targetLabel: "Game Detail · real files", runSelected: enabled, runAll: enabled, notices: [], run }
}
/** The Checks window: failures first, the passes folded into one line. */
export function checksView(): ChromeView {
  const view = emptyView()
  const row = (index: number, state: string, device: string, status: "Passed" | "Failed" | "Review", detail: string, findings: { label: string, status: "Passed" | "Failed" | "NotRun" | "Review", detail: string }[] = []) => ({
    index, part: "Game Detail", state, device, take: null, badge: { status, label: status === "Passed" ? "Passed" : status === "Failed" ? "Failed" : "Needs review", detail },
    findings: findings.map((finding, at) => ({ id: `${index}-${at}`, ...finding })), authored: [], provenance: "Declared in src/pages/PicoGameDetail.page.part.tsx", authoredSummary: "",
    images: [], approval: blocked("No saved render yet"), reviewed: false, approved: false, approvalNote: "",
  })
  const rows = [
    row(0, "Confirm removal", "RG353M", "Failed", "threw while rendering: Cannot read properties of undefined (reading 'title')", [
      { label: "render", status: "Failed", detail: "threw while rendering: Cannot read properties of undefined (reading 'title')" },
      { label: "cancel keeps the game", status: "NotRun", detail: "not run: the render failed first" },
    ]),
    row(1, "Default", "RG353M", "Passed", "render, image, play launches or asks where, back returns to the library"),
    { ...row(2, "Default", "ODIN 2 PORTAL", "Review", "render · no accepted image yet"),
      images: [{ key: "first", kind: "first" as const, url: PICO_GAME_DETAIL, label: "First render", caption: "Saved at 13:40" }, { key: "repeat", kind: "repeat" as const, url: PICO_GAME_DETAIL, label: "Repeat render", caption: "Saved at 13:40, same pixels" }],
      approval: enabled, approvalNote: "Approving makes this render the baseline for later runs. It says the image looks right, not that it behaves right." },
    row(3, "No art or history", "RG353M", "Passed", "render, image"),
    row(4, "No art or history", "ODIN 2 PORTAL", "Passed", "render, image"),
    row(5, "Multiple locations", "RG353M", "Passed", "render, image"),
    row(6, "Multiple locations", "ODIN 2 PORTAL", "Passed", "render, image"),
    row(7, "Choose location", "RG353M", "Passed", "render, image"),
    row(8, "Choose location", "ODIN 2 PORTAL", "Passed", "render, image"),
    row(9, "Confirm removal", "ODIN 2 PORTAL", "Passed", "render, image"),
  ]
  return {
    ...view, tools: { ...view.tools, active: "checks" },
    checks: checksOpen({ _tag: "Ready", id: "run-7", badge: { status: "Failed", label: "1 failed", detail: "of 10" }, stale: false, summary: "of 10 · real files · 13:40",
      coverage: "Declared states on both devices. Checks cover render, image and the named interactions; they do not prove every state combination.",
      runDetail: "Run 7 at source generation 42, Chromium 149, 2 devices.", reportUrl: "data:application/json,%7B%22run%22%3A7%7D", rows }),
  }
}
export function checksRunningView(): ChromeView {
  const view = checksView()
  return { ...view, checks: { ...checksOpen({ _tag: "Running", id: "run-8", progress: "Rendering 4 of 10: Multiple locations on the ODIN 2 PORTAL", stop: enabled }), runSelected: blocked("Checks are running"), runAll: blocked("Checks are running") } }
}

/** The credit-card outline and the scale slider. */
export function calibrateView(): ChromeView {
  const view = emptyView()
  return { ...view, tools: { ...view.tools, active: "calibrate" }, calibration: { _tag: "Open", pxPerMm: 3.875, calibrated: true } }
}

/** An alternate under review: exact revision, checks passed, attestation not yet given. */
export function alternateView(): ChromeView {
  const view = logView()
  const take = summary("7", { name: "Quiet variant of Cover at half", kind: "Alternate", accept: blocked("Apply the reviewed alternate instead"), direction: null })
  return {
    ...view, focusedTake: take,
    record: { _tag: "Open", take, log: [], emptyLogMessage: "The alternate's agent proposes an integration; its log starts after review.", integration: {
      _tag: "Review", sourceTake: "6", refresh: enabled, check: enabled, apply: blocked("Confirm that you reviewed product behavior"), behaviorReviewed: false, notices: [],
      review: {
        revision: "r-3f9a", files: [{ path: "src/pages/PicoGameDetail.tsx", before: "export const layout = \"stacked\"\n", after: "export const layout = props.layout ?? \"stacked\"\n" }],
        checks: { _tag: "Passed", summary: "Every original state renders as before; the alternate shows in Default." },
        proposal: { strategy: "variant", summary: "Add a side-by-side layout as an option of PicoGameDetail.", shared: "Both layouts share the actions and the facts.", preserved: "Existing callers keep the stacked layout.", usage: "<PicoGameDetail layout=\"beside\" />", preview: DEFAULT },
      },
    } },
  }
}

/** The dev server is gone. What was on screen stays; writes wait. */
export function unreachableView(): ChromeView {
  const view = takesView()
  return { ...view, connection: { _tag: "Unreachable", reason: "Vite stopped answering at 13:52. Caliper retries every 2 seconds." }, composer: { ...view.composer, start: blocked("Vite is not reachable") } }
}

/** Setup problems, a scenario with children, and a take whose state was removed. */
export function setupProblemsView(): ChromeView {
  const view = takesView()
  const home = { part: "src/pages/PicoHome.page.part.tsx", state: "default" }
  return {
    ...view,
    navigation: {
      ...view.navigation,
      scenario: { _tag: "Selected", subject: DEFAULT, editingLabel: "Editing Game Detail · Default", choices: view.navigation.scenario._tag === "Selected" ? view.navigation.scenario.choices : [], chosen: "home",
        note: "", whole: { ref: home, label: "Home · Default" },
        children: [{ ref: DEFAULT, label: "Game Detail · Default", selected: true }, { ref: { part: "src/organisms/PicoShelf.organism.part.tsx", state: "default" }, label: "Shelf · Default", selected: false }] },
      unavailable: [{ subject: { part: "src/pages/PicoOld.page.part.tsx", state: "Gone" }, label: "Old page · Gone (removed)", takes: [{ id: "4", label: "4 · Review or discard", selected: false }] }],
      setup: [
        { label: "Entry", status: "Derived", values: ["src/main.tsx"], provenance: "index.html:12", problems: [] },
        { label: "CSS", status: "Overridden", values: ["src/styles/pico-tokens.css"], provenance: "vite.config.ts: caliper({ css })", problems: [] },
        { label: "Wrapper", status: "Failed", values: [], provenance: "Set caliper({ wrap }) in vite.config.ts", problems: ["No component wraps the app in src/main.tsx."] },
      ],
      setupProblems: ["src/pages/PicoHome.page.part.tsx: composition.default names a state that does not exist."],
    },
  }
}

/**
 * Take markup on the RG353M's 640 x 480 viewport, as the mockup draws it:
 * 6A on the cover's caption, 6B a box round the title, 5A on the facts, and
 * 3A, whose element take 3 no longer has. 2A was placed on the ODIN 2 PORTAL,
 * so no frame on this canvas shows it.
 */
function mockupMarks(view: ChromeView, overrides: { readonly lost?: boolean } = {}): LocalMark[] {
  const on = on_(view)
  const located = { _tag: "Located" } as const
  const base = { previewLabel: "Default", deviceLabel: rg353m.name }
  return [
    { id: "m-6a", ...on("6"), letter: "A", kind: "Point", rect: point(403, 211), location: located, note: "Love this", ...base },
    { id: "m-6b", ...on("6"), letter: "B", kind: "Region", rect: { x: 141, y: 77, width: 166, height: 125 }, location: located, note: "Too heavy. Thin the border to one pixel", ...base },
    { id: "m-5a", ...on("5"), letter: "A", kind: "Point", rect: point(448, 307), location: located, note: "Restore the old row here", ...base },
    { id: "m-3a", ...on("3"), letter: "A", kind: "Point", rect: point(307, 384),
      location: overrides.lost === false ? located : { _tag: "Lost", reason: "Element not found after the restart. Re-place or remove 3A." }, note: "Keep the chip shape", ...base },
    { id: "m-2a", ...on("2"), frame: null, letter: "A", kind: "Region", rect: { x: 960, y: 700, width: 640, height: 240 }, location: located,
      note: "The stats need this much room on the big screen", previewLabel: "Default", deviceLabel: odin.name },
  ]
}
/** A point mark's rect: the clicked point, with no size. */
const point = (x: number, y: number) => ({ x, y, width: 0, height: 0 })
/** Where a mark on take N ("0": the real files) sits: its source and the frame that shows it. */
const on_ = (view: ChromeView) => (take: string) => {
  const found = view.canvas._tag === "Frames" ? view.canvas.frames.find(item => item.take === (take === "0" ? null : take)) : undefined
  if (!found) throw new Error(`The fixture has no frame for ${take === "0" ? "the real files" : `take ${take}`}`)
  return { source: sourceOf(found), frame: found.key }
}
function marked(state: Partial<MarkupState>, options: { readonly lost?: boolean; readonly change?: (view: ChromeView) => ChromeView } = {}): ChromeView {
  const view = (options.change ?? (item => item))(takesView())
  return withMarkup(view, mockupMarks(view, options), { revision: 7, mode: { _tag: "Off" }, draftOpen: false, editor: null, ...state })
}
/** The mockup's mark state: mark mode on, the note editor open at 6B. 3A is lost, so Send waits. */
export function markView(): ChromeView { return marked({ mode: { _tag: "Marking" }, editor: "m-6b" }) }
/** Marks on the takes with mark mode off: the pins stay, and the frames take clicks again. */
export function markedView(): ChromeView { return marked({}) }
/** The mockup's draft state: the draft unfolded above the bar, 3A lost. */
export function draftView(): ChromeView { return marked({ draftOpen: true }) }
/** Every mark found: Send is ready. */
export function draftReadyView(): ChromeView { return marked({ draftOpen: true }, { lost: false }) }
/** Not drawn: Re-place 3A. The next click or drag on take 3 moves it. */
export function replacingView(): ChromeView { return marked({ mode: { _tag: "Replacing", id: "m-3a" }, draftOpen: true }) }
/** Not drawn: Send is running. Nothing in the draft can change. */
export function sendingView(): ChromeView { return marked({ draftOpen: true, send: { _tag: "Sending", label: "Sending 5 marks" } }, { lost: false }) }
/** Not drawn: the server refused the pass. The reason is an alert in the bar; Send can be tried again. */
export function sendFailedView(): ChromeView {
  return marked({ send: { _tag: "Failed", label: "Send · 4 new takes", reason: "Take 5 changed after you marked it. Check its marks, then send again.", availability: enabled } }, { lost: false })
}
/** Not drawn: take 5 is still working, so the whole pass waits. */
export function markRunningView(): ChromeView {
  return marked({ draftOpen: true }, { lost: false, change: view => ({ ...view, canvas: mapFrames(view, item => item.take === "5" ? { ...item, run: { _tag: "Running" } as const } : item) }) })
}

/**
 * Marks on the real files (phase 6, plan decision 8), as the mockup draws
 * 0A: a pin on the old actions list, and 0B, a box round the title.
 */
function originalMarks(view: ChromeView): LocalMark[] {
  const base = { ...on_(view)("0"), previewLabel: "Default", deviceLabel: rg353m.name, location: { _tag: "Located" } as const }
  return [
    { id: "m-0a", ...base, letter: "A", kind: "Point", rect: point(205, 341), note: "The old actions list was clearer" },
    { id: "m-0b", ...base, letter: "B", kind: "Region", rect: { x: 276, y: 30, width: 190, height: 70 }, note: "The title's size was right" },
  ]
}
const renote = (marks: readonly LocalMark[], notes: Readonly<Record<string, string>>) => marks.map(mark => notes[mark.id] === undefined ? mark : { ...mark, note: notes[mark.id] ?? mark.note })
/**
 * The mockup's draft with references (plan decisions 6 to 8): 6B says "like
 * 0A" and 5A "restore 0A here, with the spacing of 3A". So the real files
 * and take 3 are material for 6's and 5's agents and make no take; 6, 5 and
 * 2 make one each. The draft is open.
 */
export function referencesView(): ChromeView {
  const view = takesView()
  const marks = [originalMarks(view)[0]!, ...renote(mockupMarks(view, { lost: false }), {
    "m-6b": "Too heavy. Thin the border to one pixel, like 0A", "m-5a": "Restore 0A here, with the spacing of 3A",
  })]
  return withMarkup(view, marks, { revision: 9, mode: { _tag: "Off" }, draftOpen: true, editor: null })
}
/**
 * The mockup's mark state with the type-ahead open: mark mode on, the note at
 * 6B reads "… like 0", and the list offers 0A and 0B on the real files, each
 * with a crop. 3A is lost, so it has no picture.
 */
export function typeaheadView(): ChromeView {
  const view = takesView()
  const marks = [...originalMarks(view), ...renote(mockupMarks(view), { "m-6b": "Too heavy. Thin the border to one pixel, like 0" })]
  return withMarkup(view, marks, { revision: 8, mode: { _tag: "Marking" }, draftOpen: false, editor: "m-6b" })
}
/** Marks on the real files in mark mode: 0A and 0B. No note points to them, so Send makes one take from the real files. */
export function originalView(): ChromeView {
  const view = takesView()
  return withMarkup(view, originalMarks(view), { revision: 3, mode: { _tag: "Marking" }, draftOpen: false, editor: null })
}
/**
 * First run with a typed prompt (planner choice 14): 0A and 0B on the real
 * files go with the prompt when you press New take, so New take stays the
 * main button and the draft says so. Send is in its menu.
 */
export function withPromptView(): ChromeView {
  const first = emptyView()
  const view: ChromeView = { ...first, composer: { ...first.composer, prompt: "Tidy the actions and keep the title", start: enabled } }
  return withMarkup(view, originalMarks(view), { revision: 4, mode: { _tag: "Off" }, draftOpen: true, editor: null })
}

export type FixtureName = keyof typeof FIXTURES
/** Every fixture by name. The gallery and the gates walk this list. */
export const FIXTURES = {
  takes: takesView, empty: emptyView, none: noneView, prompt: promptView, planning: planningView,
  log: logView, running: runningView, failedTake: failedTakeView, agentFailed: agentFailedView, agentOff: agentOffView,
  knobs: knobsView, knobsFinding: knobsFindingView, code: codeView, codeWatching: codeWatchingView, codeLoading: codeLoadingView, codeFailed: codeFailedView,
  grid: gridView, error: errorView, odin: odinView, checks: checksView, checksRunning: checksRunningView, calibrate: calibrateView,
  alternate: alternateView, unreachable: unreachableView, setup: setupProblemsView,
  mark: markView, marked: markedView, draft: draftView, draftReady: draftReadyView, replacing: replacingView,
  sending: sendingView, sendFailed: sendFailedView, markRunning: markRunningView,
  chainHistory: chainHistoryView, chainsAccepted: chainsAcceptedView, chainsOdin: chainsOdinView,
  references: referencesView, typeahead: typeaheadView, original: originalView, withPrompt: withPromptView,
} satisfies Record<string, () => ChromeView>
