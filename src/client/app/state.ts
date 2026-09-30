import type { Part, Project, StateRef, TakesSnapshot, TakeView, Direction } from "../../types"
import type { ChromeView, Tool } from "../ui/contract"
import { DEFAULT_PX_PER_MM, DEVICES } from "../device-frame.js"
import { contextsFor, sameState, stateExists } from "../scenarios.js"
import type { FrameReport } from "./wire"

export type Ask = StateRef & { device: string; prompt: string; context?: StateRef; images?: { name: string; mimeType: string; data: string }[] }
export type Submission = { rawPrompt: string; attachmentIds: readonly string[] }
export type Plan =
  | { _tag: "None" }
  | { _tag: "Planning"; ask: Ask; submitted: Submission; count: number; id: number }
  | { _tag: "Review"; ask: Ask; submitted: Submission; directions: { id: string; direction: Direction }[]; note: string }
export type AppState = {
  connection: ChromeView["connection"]
  project: Project | null
  takes: TakesSnapshot | null
  part: string | null
  shown: { _tag: "All" } | { _tag: "One" | "Takes"; export: string }
  context: StateRef | null
  contextNote: string
  take: string | null
  takeCreated: number | null
  filter: string
  expanded: ReadonlyMap<string, boolean>
  device: typeof DEVICES[number]
  pxPerMm: number
  calibrated: boolean
  tools: { active: Tool; navOpen: boolean; codeOpen: boolean; side: "closed" | "knobs" | "record"; codeShare: number }
  checksOpen: boolean
  calibrationOpen: boolean
  prompt: string
  count: 1 | 2 | 3 | 4
  operation: { _tag: "Idle" } | { _tag: "Working"; name: string }
  plan: Plan
  attachments: { id: string; name: string; mimeType: string; data: string; url: string }[]
  notices: ChromeView["composer"]["notices"]
  reports: ReadonlyMap<string, FrameReport>
  /** Chains whose history is open. Not remembered. */
  chainsOpen: ReadonlySet<string>
  /** Chains whose pair shows the parent when it does not fit (planner choice 19). Remembered. */
  chainSolo: ReadonlySet<string>
}
/** Chain ids are `take@created` of the chain's first take; a damaged preference reads as none. */
function savedChainSolo(storage: Preferences): ReadonlySet<string> {
  try {
    const saved: unknown = JSON.parse(storage.getItem("caliper:chain-solo") ?? "[]")
    return new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string" && /^[1-9]\d*@\d+$/.test(id)) : [])
  } catch {
    return new Set()
  }
}
export type Preferences = { getItem(key: string): string | null }
export function createAppState(hash = "", storage: Preferences = { getItem: () => null }): AppState {
  const saved = new URLSearchParams(hash.replace(/^#/, ""))
  const shown = saved.get("state")
  const px = Number(storage.getItem("caliper:px-per-mm"))
  const selectedDevice = saved.get("device") ?? storage.getItem("caliper:device")
  const created = saved.has("takeCreated") ? Number(saved.get("takeCreated")) : NaN
  const savedTool = storage.getItem("caliper:view")
  const active: Tool = savedTool === "code" || savedTool === "takes" || savedTool === "knobs" ? savedTool : "preview"
  return {
    connection: { _tag: "Connecting" }, project: null, takes: null,
    part: saved.get("part"), shown: shown === "*" ? { _tag: "All" } : shown?.startsWith("takes:") ? { _tag: "Takes", export: shown.slice(6) || "default" } : { _tag: "One", export: shown || "default" },
    context: saved.has("contextPart") ? { part: saved.get("contextPart") ?? "", state: saved.get("contextState") ?? "default" } : null,
    contextNote: "", take: saved.get("take"), takeCreated: Number.isFinite(created) && created >= 0 ? created : null, filter: "", expanded: new Map(),
    device: DEVICES.find(device => device.id === selectedDevice) ?? DEVICES[0]!, pxPerMm: Number.isFinite(px) && px > 0 ? px : DEFAULT_PX_PER_MM, calibrated: Number.isFinite(px) && px > 0,
    // navOpen is the docked parts column, a remembered preference. The UI owns the small-screen drawer.
    tools: { active, navOpen: storage.getItem("caliper:nav-open") !== "false", codeOpen: storage.getItem("caliper:code-open") === "true", side: storage.getItem("caliper:side") === "knobs" && storage.getItem("caliper:knobs-open") === "true" ? "knobs" : "closed", codeShare: clampShare(Number(storage.getItem("caliper:code-share")) || 0.45) },
    checksOpen: false, calibrationOpen: false, prompt: "", count: 1, operation: { _tag: "Idle" }, plan: { _tag: "None" }, attachments: [], notices: [], reports: new Map(),
    chainsOpen: new Set(), chainSolo: savedChainSolo(storage),
  }
}
export function clampShare(value: number) { return Math.min(0.8, Math.max(0.2, value)) }
export function currentPart(state: AppState): Part | null { return state.project?.parts.find(part => part.file === state.part) ?? null }
export function subjectRef(state: AppState): StateRef | null {
  if (!state.part) return null
  if (state.shown._tag === "All") return currentPart(state)?.states.length === 1 ? { part: state.part, state: "default" } : null
  return { part: state.part, state: state.shown.export }
}
export function previewRef(state: AppState): StateRef | null { return state.context ?? subjectRef(state) }
export function currentTake(state: AppState): TakeView | null {
  return state.shown._tag === "Takes" ? state.takes?.takes.find(take => take.take === state.take && (state.takeCreated === null || take.created === state.takeCreated) && take.part === state.part && take.state === subjectRef(state)?.state) ?? null : null
}
export function partTakes(state: AppState, part = state.part, exported = subjectRef(state)?.state): readonly TakeView[] {
  return state.takes?.takes.filter(take => take.part === part && take.state === exported) ?? []
}
export function askAvailable(state: AppState, ask: StateRef & { context?: StateRef }) {
  const parts = state.project?.parts ?? []
  return stateExists(parts, ask) && (!ask.context || contextsFor(parts, ask).some(ref => sameState(ref, ask.context!)))
}
export function takeAvailable(state: AppState, take: TakeView) { return askAvailable(state, take) }
export function refLabel(state: AppState, ref: StateRef) {
  const part = state.project?.parts.find(part => part.file === ref.part)
  return `${part?.name ?? ref.part} · ${part?.states.find(candidate => candidate.export === ref.state)?.label ?? ref.state}`
}
export function takeName(take: TakeView) { return take.name ?? take.direction?.title ?? `Take ${take.take}` }
export function frameKey(preview: StateRef, take: Pick<TakeView, "take" | "created"> | null) { return JSON.stringify([preview.part, preview.state, take?.take ?? null, take?.created ?? null]) }
export function locationHash(state: AppState) {
  const params = new URLSearchParams()
  if (state.part) params.set("part", state.part)
  if (state.shown._tag === "All") params.set("state", "*")
  else if (state.shown._tag === "Takes") params.set("state", `takes:${state.shown.export}`)
  else if (state.shown.export !== "default") params.set("state", state.shown.export)
  params.set("device", state.device.id)
  if (state.take) {
    params.set("take", state.take)
    if (state.takeCreated !== null) params.set("takeCreated", String(state.takeCreated))
  }
  if (state.context) { params.set("contextPart", state.context.part); params.set("contextState", state.context.state) }
  return `#${params}`
}
/** Preserve unavailable take ownership. Only a viewer selection falls back after source removal. */
export function reconcileSelection(state: AppState): AppState {
  if (!state.project) return state
  const parts = state.project.parts
  if (state.take && state.takes) {
    const selected = currentTake(state)
    if (!selected) state = { ...state, take: null, takeCreated: null, tools: { ...state.tools, side: state.tools.side === "record" ? "closed" : state.tools.side } }
    else if (state.takeCreated === null) state = { ...state, takeCreated: selected.created }
  }
  if (state.take && (!state.takes || currentTake(state))) {
    const subject = subjectRef(state)
    if (state.context && subject && !contextsFor(parts, subject).some(ref => sameState(ref, state.context!))) {
      return { ...state, context: null, contextNote: "The selected context is not declared for this state. Showing the isolated state; choose another Preview." }
    }
    return state
  }
  let next = state
  if (!parts.some(part => part.file === next.part)) next = { ...next, part: parts[0]?.file ?? null, shown: { _tag: "One", export: "default" }, take: null }
  if (next.shown._tag !== "All" && !stateExists(parts, { part: next.part ?? "", state: next.shown.export })) next = { ...next, shown: { _tag: "One", export: "default" }, take: null, contextNote: "The selected state no longer exists. Showing Default." }
  const subject = subjectRef(next)
  if (next.context && (!subject || !contextsFor(parts, subject).some(ref => sameState(ref, next.context!)))) next = { ...next, context: null, contextNote: "The selected context is not declared for this state. Showing the isolated state; choose another Preview." }
  return next
}
