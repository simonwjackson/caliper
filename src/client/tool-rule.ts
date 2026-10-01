/**
 * The tool rule: what a tool press or a Close does to the panes. One pure
 * rule for the app, the gallery and the contract tests, so the gallery judges
 * a chrome change against the behaviour the app has. Each caller keeps its
 * own effects (saved preferences, a checks run) and its own region content.
 *
 * A pressed tool is the thing in front (docs/plans/react-chrome-ui-notes.md).
 * Pressing a closed pane opens it; pressing an open pane that another tool
 * covers brings it to the front; pressing the pane in front closes it.
 * Closing brings back the most recent tool that is still open, else Preview.
 * Preview and Takes are views of the canvas and are always open; Takes shows
 * the take's record in the side slot when there is a take.
 */
import type { Tool } from "./ui/contract"

export type Side = "closed" | "knobs" | "record"
/** What is open and which tool is in front. */
export type OpenPanes = {
  readonly active: Tool
  readonly codeOpen: boolean
  readonly side: Side
  readonly checksOpen: boolean
  readonly calibrationOpen: boolean
}
export type Panes = OpenPanes & {
  /** Tools in the order they came to the front, the most recent last. Each tool appears once. */
  readonly recent: readonly Tool[]
}
/** A pane with its own Close. The record is the Takes view's side panel. */
export type Closable = "code" | "knobs" | "checks" | "calibrate" | "record"
export type ToolEvent =
  /** `hasTake`: whether Takes has a take whose record it can show. */
  | { readonly _tag: "Press"; readonly tool: Tool; readonly hasTake: boolean }
  | { readonly _tag: "Close"; readonly pane: Closable }

type Pane = "code" | "knobs" | "checks" | "calibrate"
const isPane = (tool: Tool): tool is Pane => tool === "code" || tool === "knobs" || tool === "checks" || tool === "calibrate"

function isOpen(panes: OpenPanes, tool: Tool): boolean {
  switch (tool) {
    case "preview": case "takes": return true
    case "code": return panes.codeOpen
    case "knobs": return panes.side === "knobs"
    case "checks": return panes.checksOpen
    case "calibrate": return panes.calibrationOpen
  }
}
function withPane(panes: Panes, pane: Pane, open: boolean): Panes {
  switch (pane) {
    case "code": return { ...panes, codeOpen: open }
    case "knobs": return { ...panes, side: open ? "knobs" : panes.side === "knobs" ? "closed" : panes.side }
    case "checks": return { ...panes, checksOpen: open }
    case "calibrate": return { ...panes, calibrationOpen: open }
  }
}
const toFront = (panes: Panes, tool: Tool): Panes => ({ ...panes, active: tool, recent: [...panes.recent.filter(item => item !== tool), tool] })
/** After a pane closes: the most recent tool still open, else Preview. */
function back(panes: Panes): Panes {
  const open = [...panes.recent].reverse().find(tool => isOpen(panes, tool))
  return toFront(panes, open ?? "preview")
}
function closePane(panes: Panes, pane: Pane): Panes {
  if (!isOpen(panes, pane)) return panes
  const closed = withPane(panes, pane, false)
  return panes.active === pane ? back(closed) : closed
}

/**
 * The history for panes that come from saved preferences or a fixture: the
 * open panes, then the tool in front. An open record counts as Takes.
 */
export function restorePanes(open: OpenPanes): Panes {
  const earlier: Tool[] = []
  if (open.side === "record") earlier.push("takes")
  for (const tool of ["code", "knobs", "calibrate", "checks"] as const) if (isOpen(open, tool)) earlier.push(tool)
  return { ...open, recent: [...earlier.filter(tool => tool !== open.active), open.active] }
}

export function nextPanes(current: Panes, event: ToolEvent): Panes {
  // A caller can bring a tool to the front itself, as selecting a take does.
  const panes = current.recent.at(-1) === current.active ? current : toFront(current, current.active)
  if (event._tag === "Close") {
    if (event.pane !== "record") return closePane(panes, event.pane)
    return panes.side === "record" ? { ...panes, side: "closed" } : current
  }
  const { tool } = event
  if (tool === "takes") return toFront({ ...panes, side: event.hasTake ? "record" : "closed" }, "takes")
  if (!isPane(tool)) return toFront(panes, tool)
  if (!isOpen(panes, tool)) return toFront(withPane(panes, tool, true), tool)
  return panes.active === tool ? closePane(panes, tool) : toFront(panes, tool)
}
