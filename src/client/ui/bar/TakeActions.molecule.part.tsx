import { TakeActions } from "./TakeActions"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { alternateView, runningView, takesView } from "../fixtures/views"
import type { ChromeView } from "../contract"

export const name = "Take actions"
export const note = "Accept and Discard; Stop while the agent works. An alternate is applied from its review instead."

function Actions({ make }: { readonly make: () => ChromeView }) {
  const { view, actions } = useFixture(make)
  return <PartScope>{view.focusedTake && <TakeActions take={view.focusedTake} actions={actions} />}</PartScope>
}
export default function Ready() { return <Actions make={takesView} /> }
export function Running() { return <Actions make={runningView} /> }
export function Alternate() { return <Actions make={alternateView} /> }
