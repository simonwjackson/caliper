import { Questions } from "./Questions"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { FIXTURES } from "../fixtures/views"
import type { ChromeView } from "../contract"

export const name = "Questions"
export const note = "Decision 45: the question, the open questions with Answer, the answered ones with their reasons, Add, and Discard."

function Scene({ make, width = "21rem" }: { readonly make: () => ChromeView; readonly width?: string }) {
  const { view, actions } = useFixture(make)
  return <PartScope width={width} height="40rem"><Questions view={view} actions={actions} sheet={false} /></PartScope>
}
export default function Asked() { return <Scene make={FIXTURES.workspaceBoard} /> }
export function NothingAsked() { return <Scene make={FIXTURES.workspaceFrame} /> }
export function NewWorkspace() { return <Scene make={FIXTURES.workspaceNew} /> }
export function Closed() { return <Scene make={FIXTURES.workspaceClosed} /> }
