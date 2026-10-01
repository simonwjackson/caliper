/**
 * Tool presses and Closes for the local scenarios: the gallery's and the
 * contract tests'. Each goes through the tool rule the app uses
 * (`src/client/tool-rule.ts`), so a chrome change is judged against the app's
 * behaviour (decision 18). A newly opened region gets the local content a real
 * app shows next. It performs no I/O.
 *
 * Two things the view does not carry stay here, both derived from the views
 * it is given: the order tools came to the front, and the last record shown,
 * so Takes can show it again after its Close as the app does.
 */
import type { ChromeView, Tool } from "../contract"
import { nextPanes, restorePanes } from "../../tool-rule"
import type { Closable, OpenPanes, ToolEvent } from "../../tool-rule"

export type LocalTools = {
  readonly press: (view: ChromeView, tool: Tool) => ChromeView
  readonly close: (view: ChromeView, pane: Closable) => ChromeView
  /** A workspace's questions open in the record's place (decision 45), as the app's Takes press with a take does. */
  readonly questions: (view: ChromeView) => ChromeView
}
type Record = Extract<ChromeView["record"], { _tag: "Open" }>

const openOf = (view: ChromeView): OpenPanes => ({
  active: view.tools.active, codeOpen: view.tools.codeOpen, side: view.tools.side,
  checksOpen: view.checks._tag !== "Closed", calibrationOpen: view.calibration._tag !== "Closed",
})

export function createLocalTools(initial: ChromeView): LocalTools {
  let recent = restorePanes(openOf(initial)).recent
  let record: Record | null = null
  const apply = (view: ChromeView, event: (shown: Record | null) => ToolEvent): ChromeView => {
    if (view.record._tag === "Open") record = view.record
    const panes = nextPanes({ ...openOf(view), recent }, event(record))
    recent = panes.recent
    return {
      ...view,
      tools: { ...view.tools, active: panes.active, codeOpen: panes.codeOpen, side: panes.side },
      code: panes.codeOpen && view.code._tag === "Closed" ? { _tag: "Loading", message: "Loading the editor" } : view.code,
      knobs: panes.side === "knobs" && view.knobs._tag === "Closed" ? { _tag: "Finding", target: "Game Detail, Default" } : view.knobs,
      record: panes.side === "record" && record ? record : { _tag: "Closed" },
      checks: !panes.checksOpen ? { _tag: "Closed" }
        : view.checks._tag !== "Closed" ? view.checks
        : { _tag: "Open", targetLabel: "Game Detail · real files", runSelected: { _tag: "Enabled" }, runAll: { _tag: "Enabled" }, notices: [], run: { _tag: "Idle" } },
      calibration: !panes.calibrationOpen ? { _tag: "Closed" }
        : view.calibration._tag !== "Closed" ? view.calibration
        : { _tag: "Open", pxPerMm: view.pxPerMm, calibrated: view.calibrated },
    }
  }
  return {
    press: (view, tool) => apply(view, shown => ({ _tag: "Press", tool, hasTake: shown !== null })),
    close: (view, pane) => apply(view, () => ({ _tag: "Close", pane })),
    questions: view => apply(view, () => ({ _tag: "Press", tool: "takes", hasTake: true })),
  }
}
