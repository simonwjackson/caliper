import { ReviewDiff } from "./ReviewDiff"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { alternateView } from "../fixtures/views"

export const name = "Review diff host"
export const note = "The host core mounts a read-only diff in, for one take, revision and file. Empty until core fills it."

export default function Host() {
  const { actions } = useFixture(alternateView)
  return <PartScope width="19rem"><ReviewDiff take="7" revision="r-3f9a" file="src/pages/PicoGameDetail.tsx" actions={actions} /></PartScope>
}
