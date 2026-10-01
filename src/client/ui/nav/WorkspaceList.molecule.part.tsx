import { WorkspaceList } from "./WorkspaceList"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { FIXTURES } from "../fixtures/views"
import type { ChromeView } from "../contract"

export const name = "Workspace list"
export const note = "Decision 45: the workspaces above the parts, New, and how far each one is."

function Scene({ make, pinning = false }: { readonly make: () => ChromeView; readonly pinning?: boolean }) {
  const { view, actions } = useFixture(make)
  return <PartScope width="16.5rem"><div className="dr-parts__tree">
    <WorkspaceList workspaces={view.navigation.workspaces} pinning={pinning} actions={actions} picked={() => {}} />
  </div></PartScope>
}
export default function Selected() { return <Scene make={FIXTURES.workspaceBoard} /> }
export function Pinning() { return <Scene make={FIXTURES.workspaceNew} pinning /> }
export function NoneYet() { return <Scene make={FIXTURES.takes} /> }
