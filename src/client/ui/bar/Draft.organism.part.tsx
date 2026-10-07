import { Draft } from "./Draft"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { draftReadyView, draftView, referencesView, sendingView, withPromptView } from "../fixtures/views"
import type { ChromeView } from "../contract"

export const name = "Draft"
export const note = "The draft unfolded above the bar: the marked takes, wrapping to its width, marks drawn on, each note under its mark."

function Unfolded({ make, width = "75rem" }: { readonly make: () => ChromeView; readonly width?: string }) {
  const { view, actions } = useFixture(make)
  return <PartScope width={width}><div className="dr-bar" style={{ ["--dr-draft-h" as string]: "30rem", marginTop: "30rem" }}>
    {view.markup._tag === "Ready" && <Draft markup={view.markup} view={view} actions={actions} />}
  </div></PartScope>
}
export default function LostMark() { return <Unfolded make={draftView} /> }
export function Ready() { return <Unfolded make={draftReadyView} /> }
export function Sending() { return <Unfolded make={sendingView} /> }
export function Narrow() { return <Unfolded make={draftView} width="24rem" /> }
/** Phase 6: notes point to 0A and 3A, so the real files and take 3 make no take. */
export function References() { return <Unfolded make={referencesView} /> }
export function ReferencesNarrow() { return <Unfolded make={referencesView} width="24rem" /> }
/** Phase 6: the marks on the real files go with the typed prompt. */
export function WithPrompt() { return <Unfolded make={withPromptView} /> }
