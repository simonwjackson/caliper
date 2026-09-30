import { CodePane } from "./CodePane"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { codeFailedView, codeLoadingView, codeView, codeWatchingView } from "../fixtures/views"
import type { ChromeView } from "../contract"

export const name = "Code pane"
export const note = "Tabs, the Files menu, change steps, save state and the editor host core fills."

function Pane({ make }: { readonly make: () => ChromeView }) {
  const { view, actions } = useFixture(make)
  return <PartScope width="60rem" height="28rem"><div style={{ ["--dr-code-h" as string]: "26rem", paddingTop: "1rem" }}><CodePane view={view} actions={actions} place="below" hidden={false} /></div></PartScope>
}
export default function TakeDiff() { return <Pane make={codeView} /> }
export function Watching() { return <Pane make={codeWatchingView} /> }
export function Loading() { return <Pane make={codeLoadingView} /> }
export function Failed() { return <Pane make={codeFailedView} /> }
