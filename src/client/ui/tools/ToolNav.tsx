import type { ChromeActions, ChromeView, Tool } from "../contract"
import { CAL } from "../hooks"
import { fitTools, REM_PX } from "../layout"
import type { ToolsPlace } from "../layout"
import type { Box } from "../useBox"
import { Icon } from "../atoms/Icon"
import { MenuButton } from "../atoms/MenuButton"
import "../tokens.css"
import "./tools.css"

const LABELS: Record<Tool, string> = { preview: "Preview", takes: "Takes", code: "Code", knobs: "Knobs", checks: "Checks", calibrate: "Calibrate" }
/** The rail has no Preview: on a desk nothing covers the canvas that Preview would clear. */
const RAIL: readonly Tool[] = ["code", "takes", "knobs", "checks", "calibrate"]
const DOCK: readonly Tool[] = ["preview", "takes", "code", "knobs", "checks", "calibrate"]
/** Least used first. Parts and the canvas tools never leave. */
const OVERFLOW: readonly Tool[] = ["calibrate", "checks", "knobs", "code"]
/** Rail: a 2.25 rem button and a 0.25 rem gap. Dock: the narrowest labelled button. */
const RAIL_ITEM = 2.5
const RAIL_LEAD = 3.9
const DOCK_ITEM = 3.4

export type ToolNavProps = {
  readonly view: ChromeView; readonly actions: ChromeActions; readonly place: ToolsPlace; readonly box: Box
  readonly partsOpen: boolean; readonly drawerOpen: boolean; readonly onParts: () => void
}

function pip(view: ChromeView, tool: Tool): "good" | "bad" | "warn" | "running" | null {
  if (tool === "takes") {
    const run = view.focusedTake?.run._tag
    return run === "Running" ? "running" : run === "Failed" ? "bad" : null
  }
  if (tool !== "checks") return null
  const status = view.checks._tag === "Open" && view.checks.run._tag === "Ready" ? view.checks.run.badge.status
    : view.navigation.parts.flatMap(part => part.states).find(state => state.selected)?.badge?.status
  if (status === "Passed" || status === "Accepted") return "good"
  if (status === "Failed") return "bad"
  if (status === "Review" || status === "Stale" || status === "Inconclusive") return "warn"
  return null
}

/**
 * The tools: a rail at the left on a desk, a dock at the bottom on a phone.
 * A pressed tool is the one in front. On the dock the open parts drawer is in
 * front, so while it is open only Parts is marked. Tools that do not fit move
 * into More with their labels; none is removed.
 */
export function ToolNav({ view, actions, place, box, partsOpen, drawerOpen, onParts }: ToolNavProps) {
  const tools = place === "rail" ? RAIL : DOCK
  const length = place === "rail" ? box.height / REM_PX - RAIL_LEAD : box.width / REM_PX
  const size = place === "rail" ? RAIL_ITEM : DOCK_ITEM
  const fit = fitTools(length || 100, { tools: [{ id: "parts", size }, ...tools.map(id => ({ id, size }))], gap: 0, more: size, overflowOrder: OVERFLOW })
  const inline = tools.filter(tool => fit.inline.includes(tool))
  const overflow = tools.filter(tool => fit.overflow.includes(tool))
  const pressed = (tool: Tool) => view.tools.active === tool && !(place === "dock" && drawerOpen)
  const button = (tool: Tool, inMenu = false) => {
    const mark = pip(view, tool)
    return <button key={tool} type="button" className={inMenu ? "dr-tools__item" : "dr-tool"} data-cal={CAL.tool} data-tool={tool}
      role={inMenu ? "menuitem" : undefined} aria-pressed={inMenu ? undefined : pressed(tool)} aria-current={inMenu && pressed(tool) ? "true" : undefined}
      aria-label={place === "rail" && !inMenu ? LABELS[tool] : undefined} title={LABELS[tool]} onClick={() => actions.onTool(tool)}>
      <Icon name={tool} />{(place === "dock" || inMenu) && <span className="dr-tool__label">{LABELS[tool]}</span>}
      {mark && <i className={`dr-tool__pip dr-tool__pip--${mark}`} aria-hidden="true" />}
    </button>
  }
  return <nav className="dr-tools" data-place={place} aria-label="Tools">
    {place === "rail" && <span className="dr-tools__mark" aria-hidden="true"><Icon name="mark" /></span>}
    <button type="button" className="dr-tool" data-cal={CAL.navToggle} aria-expanded={partsOpen} aria-label={place === "rail" ? "Parts" : undefined} title="Parts" onClick={onParts}>
      <Icon name="parts" />{place === "dock" && <span className="dr-tool__label">Parts</span>}
    </button>
    {inline.map(tool => button(tool))}
    {overflow.length > 0 && <MenuButton label="More tools" triggerClass="dr-tool" menuClass="dr-tools__menu" pressed={overflow.some(pressed)} placement={place === "rail" ? "beside" : "above"}
      trigger={<><Icon name="more" />{place === "dock" && <span className="dr-tool__label">More</span>}</>}>
      {overflow.map(tool => button(tool, true))}
    </MenuButton>}
  </nav>
}
