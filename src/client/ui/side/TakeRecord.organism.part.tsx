import { TakeRecord } from "./TakeRecord"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { alternateView, chainsAcceptedView, failedTakeView, logView, runningView } from "../fixtures/views"
import type { ChromeView } from "../contract"

export const name = "Take record"
export const note = "A take's record in the side panel: facts, direction, files, conversation and actions."

function Record({ make }: { readonly make: () => ChromeView }) {
  const { view, actions } = useFixture(make)
  return <PartScope width="21rem" height="52rem"><TakeRecord view={view} actions={actions} sheet={false} /></PartScope>
}
export default function Ready() { return <Record make={logView} /> }
export function Running() { return <Record make={runningView} /> }
export function Stopped() { return <Record make={failedTakeView} /> }
export function Alternate() { return <Record make={alternateView} /> }
/** Take 7 from 3 across a discarded 5, made before take 8 was accepted: the flag's reason written out. */
export function Flagged() { return <Record make={chainsAcceptedView} /> }
