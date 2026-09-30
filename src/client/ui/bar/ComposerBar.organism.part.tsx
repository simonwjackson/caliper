import { ComposerBar } from "./ComposerBar"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { agentFailedView, agentOffView, draftView, emptyView, markedView, planView, planningView, promptView, runningView, sendFailedView, sendingView, takesView } from "../fixtures/views"
import type { ChromeView } from "../contract"

export const name = "Composer bar"
export const note = "The bar under the canvas: the focused take, the prompt with its images, and New take."

function Bar({ make, width = "75rem" }: { readonly make: () => ChromeView; readonly width?: string }) {
  const { view, actions } = useFixture(make)
  return <PartScope width={width}><div style={{ paddingTop: "18rem" }}><ComposerBar view={view} actions={actions} /></div></PartScope>
}
export default function Focused() { return <Bar make={takesView} /> }
export function FirstRun() { return <Bar make={emptyView} /> }
export function Typed() { return <Bar make={promptView} /> }
export function Narrow() { return <Bar make={promptView} width="24rem" /> }
export function Plan() { return <Bar make={planView} /> }
export function Planning() { return <Bar make={planningView} /> }
export function Running() { return <Bar make={runningView} /> }
export function AgentFailed() { return <Bar make={agentFailedView} /> }
export function AgentOff() { return <Bar make={agentOffView} /> }
export function Marked() { return <Bar make={markedView} /> }
export function DraftOpen() { return <Bar make={draftView} /> }
export function DraftNarrow() { return <Bar make={draftView} width="24rem" /> }
export function Sending() { return <Bar make={sendingView} /> }
export function SendFailed() { return <Bar make={sendFailedView} /> }
