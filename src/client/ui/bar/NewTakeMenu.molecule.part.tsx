import { NewTakeMenu } from "./NewTakeMenu"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { agentFailedView, promptView, takesView } from "../fixtures/views"
import type { ChromeView } from "../contract"

export const name = "New take"
export const note = "A split button. The menu: how many takes, Send to the focused take, and the agent and its skills."

function Split({ make }: { readonly make: () => ChromeView }) {
  const { view, actions } = useFixture(make)
  return <PartScope width="24rem"><div style={{ paddingTop: "18rem", display: "flex", justifyContent: "end" }}><NewTakeMenu composer={view.composer} actions={actions} /></div></PartScope>
}
export default function Ready() { return <Split make={promptView} /> }
export function Empty() { return <Split make={takesView} /> }
export function AgentFailed() { return <Split make={agentFailedView} /> }
