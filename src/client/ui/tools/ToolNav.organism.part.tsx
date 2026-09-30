import { ToolNav } from "./ToolNav"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { checksView, runningView, takesView } from "../fixtures/views"

export const name = "Tools"
export const note = "The rail on a desk, the dock on a phone. A pressed tool is the one in front."

export default function Rail() {
  const { view, actions } = useFixture(takesView)
  return <PartScope width="3rem" height="36rem"><div className="dr-root" data-tools="rail" style={{ height: "100%" }}>
    <ToolNav view={view} actions={actions} place="rail" box={{ width: 48, height: 576 }} partsOpen drawerOpen={false} onParts={() => actions.onNavOpen(!view.tools.navOpen)} />
  </div></PartScope>
}
export function Dock() {
  const { view, actions } = useFixture(runningView)
  return <PartScope width="416px"><div className="dr-root" data-tools="dock" style={{ gridTemplateRows: "auto" }}>
    <ToolNav view={view} actions={actions} place="dock" box={{ width: 416, height: 640 }} partsOpen={false} drawerOpen={false} onParts={() => undefined} />
  </div></PartScope>
}
/** A tiny dock: Knobs, Checks and Calibrate move into More, with their labels. */
export function TinyDock() {
  const { view, actions } = useFixture(checksView)
  return <PartScope width="260px"><div className="dr-root" data-tools="dock" style={{ gridTemplateRows: "auto", paddingTop: "12rem" }}>
    <ToolNav view={view} actions={actions} place="dock" box={{ width: 260, height: 400 }} partsOpen={false} drawerOpen={false} onParts={() => undefined} />
  </div></PartScope>
}
