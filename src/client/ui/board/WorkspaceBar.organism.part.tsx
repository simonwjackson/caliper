import { WorkspaceBar } from "./WorkspaceBar"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { FIXTURES } from "../fixtures/views"
import type { ChromeView } from "../contract"

export const name = "Workspace bar"
export const note = "Decision 45: the question and Plan, then a new idea or a prompt to the focused idea, with its Discard."

function Bar({ make, width = "60rem" }: { readonly make: () => ChromeView; readonly width?: string }) {
  const { view, actions } = useFixture(make)
  return <PartScope width={width}><div style={{ paddingTop: "12rem" }}><WorkspaceBar view={view} actions={actions} /></div></PartScope>
}
export default function Idea() { return <Bar make={FIXTURES.workspaceBoard} /> }
export function Ask() { return <Bar make={FIXTURES.workspaceFrame} /> }
export function AskEmpty() { return <Bar make={FIXTURES.workspaceNew} /> }
export function Planning() { return <Bar make={FIXTURES.workspacePlanning} /> }
export function More() { return <Bar make={FIXTURES.workspaceRunning} /> }
export function Closed() { return <Bar make={FIXTURES.workspaceClosed} /> }
export function Narrow() { return <Bar make={FIXTURES.workspaceBoard} width="24rem" /> }
