import { useCallback, useEffect, useRef, useState } from "react"
import type { CSSProperties } from "react"
import type { ChromeProps, ChromeView } from "./contract"
import { CAL } from "./hooks"
import { REM_PX, codeHeight, draftHeight, frontSheet, planLayout } from "./layout"
import { useBox } from "./useBox"
import { ToolNav } from "./tools/ToolNav"
import { PartsPanel } from "./nav/PartsPanel"
import { Canvas } from "./canvas/Canvas"
import { ComposerBar } from "./bar/ComposerBar"
import { CodePane } from "./code/CodePane"
import { KnobsPanel } from "./side/KnobsPanel"
import { TakeRecord } from "./side/TakeRecord"
import { ChecksWindow } from "./checks/ChecksWindow"
import { Connection } from "./tools/Connection"
import { Board } from "./board/Board"
import { WorkspaceBar } from "./board/WorkspaceBar"
import { Questions } from "./board/Questions"
import "./tokens.css"
import "./atoms/atoms.css"
import "./darkroom.css"

export type DarkroomProps = ChromeProps & {
  /** Force a scheme; by default the chrome follows the system's light or dark choice. */
  readonly scheme?: "light" | "dark"
}

/**
 * Whether the canvas shows the composer bar under it: while one state is on
 * the canvas and Takes, Preview or a plan is in front. A take belongs to one
 * state (decision 20), so the view of every state at once has no composer.
 */
export function showsBar(view: ChromeView): boolean {
  // Decision 45: an open workspace's board always has its bar; a damaged one has none.
  if (view.workspace._tag !== "None") return view.workspace._tag === "Open"
  if (view.canvas._tag !== "Frames") return false
  if (view.selection._tag !== "State") return view.plan._tag !== "None"
  return view.plan._tag !== "None" || view.tools.active === "takes" || view.tools.active === "preview"
}
export function sideOpen(view: ChromeView): boolean {
  // While a workspace's board is on screen, the record's place holds its questions.
  if (view.tools.side === "record" && view.workspace._tag !== "None") return view.workspace._tag === "Open"
  return view.tools.side === "knobs" ? view.knobs._tag !== "Closed" : view.tools.side === "record" ? view.record._tag === "Open" : false
}

/**
 * The Darkroom chrome (decision 34): a rail or dock of tools, the parts
 * panel, the canvas with its bar, the side panel and the code pane.
 * `planLayout` places them from this element's own box.
 *
 * Every region keeps one place in the tree whatever the layout, so a frame's
 * iframe and the editor's host survive a resize, a fold or a stream update.
 */
export default function Darkroom({ view, actions, scheme }: DarkroomProps) {
  const root = useRef<HTMLDivElement>(null)
  const box = useBox(root)
  const bar = showsBar(view)
  const side = sideOpen(view)
  const board = view.workspace._tag !== "None"
  const code = view.tools.codeOpen && view.code._tag !== "Closed"
  const open = { nav: view.tools.navOpen, side, code, bar }
  const width = box.width / REM_PX
  const height = box.height / REM_PX
  const plan = planLayout(width || 100, height || 62.5, open)
  const canDock = planLayout(width || 100, height || 62.5, { ...open, nav: true }).nav === "docked"
  const front = frontSheet(plan, view.tools.active, view.tools.side)

  // The drawer is a temporary disclosure the UI owns. The docked column is the app's preference.
  const [drawer, setDrawer] = useState(false)
  useEffect(() => { if (canDock) setDrawer(false) }, [canDock])
  const drawerOpen = drawer && !canDock
  const navShown = (canDock && view.tools.navOpen) || drawerOpen
  const onParts = useCallback(() => {
    if (canDock) { setDrawer(false); actions.onNavOpen(!view.tools.navOpen) } else setDrawer(open => !open)
  }, [canDock, actions, view.tools.navOpen])
  // Closing the drawer returns focus to the Parts button that opened it.
  const closeDrawer = useCallback(() => {
    setDrawer(false)
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-cal="${CAL.navToggle}"]`)?.focus())
  }, [])

  const style = {
    "--dr-code-h": `${codeHeight(height || 62.5, view.tools.codeShare, bar)}rem`,
    "--dr-draft-h": `${draftHeight(height || 62.5)}rem`,
  } as CSSProperties
  return <div ref={root} className="dr-root" data-cal={CAL.root} data-scheme={scheme}
    data-tools={plan.tools} data-nav={drawerOpen ? "drawer" : navShown ? "docked" : "hidden"} data-side={side ? plan.side : "closed"} data-code={code ? plan.code : "closed"}
    data-front={front ?? "none"} data-bar={bar ? "on" : "off"} data-drawer={drawerOpen ? "open" : "closed"} style={style}
    onKeyDown={event => { if (event.key === "Escape" && drawerOpen) { event.stopPropagation(); closeDrawer() } }}>
    <ToolNav view={view} actions={actions} place={plan.tools} box={box} partsOpen={navShown} drawerOpen={drawerOpen} onParts={onParts} />
    <main className="dr-room">
      <Connection connection={view.connection} />
      {drawerOpen && <div className="dr-scrim" onClick={closeDrawer} aria-hidden="true" />}
      {/* Always mounted, so the filter and scroll survive closing, and the selection stays in the tree. */}
      <div className="dr-parts-host" hidden={!navShown}><PartsPanel view={view} actions={actions} drawer={drawerOpen} onClose={drawerOpen ? closeDrawer : undefined} /></div>
      <div className="dr-stage">
        {board ? <Board view={view} actions={actions} /> : <Canvas view={view} actions={actions} />}
        {code && <CodePane view={view} actions={actions} place={plan.code === "sheet" ? "sheet" : "below"} hidden={plan.code === "sheet" && front !== "code"} />}
        {bar && (board ? <WorkspaceBar view={view} actions={actions} hidden={front !== null} /> : <ComposerBar view={view} actions={actions} hidden={front !== null} />)}
      </div>
      {side && <aside className="dr-side" data-place={plan.side} hidden={plan.side === "sheet" && front !== "side"}>
        {view.tools.side === "knobs"
          ? <KnobsPanel view={view} actions={actions} sheet={plan.side === "sheet"} />
          : board ? <Questions view={view} actions={actions} sheet={plan.side === "sheet"} />
            : <TakeRecord view={view} actions={actions} sheet={plan.side === "sheet"} />}
      </aside>}
      <ChecksWindow view={view} actions={actions} />
    </main>
  </div>
}
