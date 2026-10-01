import type { Part, Project, StateRef, TakesSnapshot, TakeView, WorkspaceView } from "../../types"
import type { ChromeView, Tool } from "../ui/contract"
import { DEFAULT_PX_PER_MM, STANDARD_DEVICES, type Device } from "../device-frame.js"
import { contextsFor, sameState, stateExists } from "../scenarios.js"
import type { FrameReport } from "./wire"
import { restorePanes } from "../tool-rule"
import { rowRef } from "../../takes/workspace-contract.js"

export type Ask = StateRef & { device: string; prompt: string; context?: StateRef; images?: { name: string; mimeType: string; data: string }[]
  /** Ids of marks on the original that go with the prompt (planner choice 14). They leave the draft once takes start. */
  marks?: string[] }
export type Submission = { rawPrompt: string; attachmentIds: readonly string[] }
export type Plan =
  | { _tag: "None" }
  | { _tag: "Planning"; ask: Ask; submitted: Submission; count: number; id: number }
  /** Decision 45: the planner turns a workspace's question into ideas. */
  | { _tag: "Ideas"; workspace: string; device: string; submitted: Submission; count: number; id: number }
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
  /** The chosen device's id. It can name a device the project has not listed yet; `deviceOf` gives the device shown. */
  device: string
  pxPerMm: number
  calibrated: boolean
  tools: { active: Tool; navOpen: boolean; codeOpen: boolean; side: "closed" | "knobs" | "record"; codeShare: number }
  checksOpen: boolean
  calibrationOpen: boolean
  /** The order tools came to the front, for the tool rule (`../tool-rule`). Not saved; a reload rebuilds it. */
  recentTools: readonly Tool[]
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
  /** This tab's project in the Caliper app, and every project the app lists (decision 37). */
  projectId: string | null
  projects: readonly ProjectListing[]
  /** Decision 45: the workspace whose board replaces the canvas, and the idea the bar talks to. */
  workspace: string | null
  idea: string | null
  /**
   * Workspaces slice 2: the bar writes a new scratch row (New), talks to one
   * scratch row's agent (Focused, by its file), or neither. One of an idea
   * and a row is focused at a time.
   */
  row: { _tag: "None" } | { _tag: "New" } | { _tag: "Focused"; file: string }
  /** The row whose record holds the side panel (its board key), and the column whose results unfold. */
  rowRecord: { row: string; column: string } | null
  /** Keys of board cells whose frame shows exactly what Today's frame of that row shows. */
  same: ReadonlySet<string>
}
export type ProjectListing = { id: string; name: string; problem: string }
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
  const codeOpen = storage.getItem("caliper:code-open") === "true"
  const side = storage.getItem("caliper:side") === "knobs" && storage.getItem("caliper:knobs-open") === "true" ? "knobs" : "closed"
  return {
    connection: { _tag: "Connecting" }, project: null, takes: null,
    part: saved.get("part"), shown: shown === "*" ? { _tag: "All" } : shown?.startsWith("takes:") ? { _tag: "Takes", export: shown.slice(6) || "default" } : { _tag: "One", export: shown || "default" },
    context: saved.has("contextPart") ? { part: saved.get("contextPart") ?? "", state: saved.get("contextState") ?? "default" } : null,
    contextNote: "", take: saved.get("take"), takeCreated: Number.isFinite(created) && created >= 0 ? created : null, filter: "", expanded: new Map(),
    device: selectedDevice ?? "", pxPerMm: Number.isFinite(px) && px > 0 ? px : DEFAULT_PX_PER_MM, calibrated: Number.isFinite(px) && px > 0,
    // navOpen is the docked parts column, a remembered preference. The UI owns the small-screen drawer.
    tools: { active, navOpen: storage.getItem("caliper:nav-open") !== "false", codeOpen, side, codeShare: clampShare(Number(storage.getItem("caliper:code-share")) || 0.45) },
    checksOpen: false, calibrationOpen: false, recentTools: restorePanes({ active, codeOpen, side, checksOpen: false, calibrationOpen: false }).recent, prompt: "", count: 1, operation: { _tag: "Idle" }, plan: { _tag: "None" }, attachments: [], notices: [], reports: new Map(),
    chainsOpen: new Set(), chainSolo: savedChainSolo(storage), projectId: null, projects: [],
    workspace: saved.get("workspace"), idea: null, row: { _tag: "None" }, rowRecord: null, same: new Set(),
  }
}
/** The selected workspace as the takes snapshot has it, or null when none is selected or it is gone. */
export function currentWorkspace(state: AppState): WorkspaceView | null {
  return state.workspace === null ? null : state.takes?.workspaces.find(workspace => workspace.id === state.workspace) ?? null
}
/** The selected workspace when it can be read and is open: pins and new ideas need one. */
export function openWorkspace(state: AppState): Extract<WorkspaceView, { _tag: "Ready" }> | null {
  const workspace = currentWorkspace(state)
  return workspace?._tag === "Ready" && workspace.status._tag === "Open" ? workspace : null
}
/** The project's devices; the standard ones until the project arrives. */
export function devicesOf(state: AppState): readonly Device[] {
  return state.project?.devices.length ? state.project.devices : STANDARD_DEVICES
}
/** The device the frames show: the chosen one when the project lists it, else the project's first. */
export function deviceOf(state: AppState): Device {
  const devices = devicesOf(state)
  return devices.find(device => device.id === state.device) ?? devices[0]!
}
/** A device's name for a take or mark made on it; a device the project no longer lists keeps its id. */
export function deviceName(state: AppState, id: string) { return devicesOf(state).find(device => device.id === id)?.name ?? id }
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
/** A board row's key: the part and state it renders. */
export const rowKey = (row: StateRef) => `${row.part}#${row.state}`
export function locationHash(state: AppState) {
  const params = new URLSearchParams()
  if (state.part) params.set("part", state.part)
  if (state.shown._tag === "All") params.set("state", "*")
  else if (state.shown._tag === "Takes") params.set("state", `takes:${state.shown.export}`)
  else if (state.shown.export !== "default") params.set("state", state.shown.export)
  if (state.device) params.set("device", state.device)
  if (state.take) {
    params.set("take", state.take)
    if (state.takeCreated !== null) params.set("takeCreated", String(state.takeCreated))
  }
  if (state.context) { params.set("contextPart", state.context.part); params.set("contextState", state.context.state) }
  if (state.workspace) params.set("workspace", state.workspace)
  return `#${params}`
}
/** Preserve unavailable take ownership. Only a viewer selection falls back after source removal. */
export function reconcileSelection(input: AppState): AppState {
  const project = input.project
  if (!project) return input
  let state = input
  // A workspace that is gone, for example deleted by hand, leaves its board.
  if (state.workspace !== null && state.takes && !currentWorkspace(state)) state = { ...state, workspace: null, idea: null, row: { _tag: "None" }, rowRecord: null }
  const shown = currentWorkspace(state)
  if (state.idea !== null && (shown?._tag !== "Ready" || !shown.ideas.some(idea => idea.take === state.idea))) state = { ...state, idea: null }
  // A deleted scratch row, or one gone by hand, leaves the bar and the side panel.
  const focused = state.row
  if (focused._tag === "Focused" && (shown?._tag !== "Ready" || !shown.rows.some(row => row._tag === "Scratch" && row.file === focused.file))) state = { ...state, row: { _tag: "None" } }
  const record = state.rowRecord
  if (record !== null && state.takes && (shown?._tag !== "Ready" || !shown.rows.some(row => rowKey(rowRef(shown.id, row)) === record.row))) state = { ...state, rowRecord: null }
  const parts = project.parts
  // A device the project does not list, for example one removed from vite.config, falls back to its first.
  if (state.device !== deviceOf(state).id) state = { ...state, device: deviceOf(state).id }
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
