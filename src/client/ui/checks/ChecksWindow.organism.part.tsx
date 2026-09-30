import { ChecksWindow } from "./ChecksWindow"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { checksRunningView, checksView } from "../fixtures/views"
import type { ChromeView } from "../contract"

export const name = "Checks window"
export const note = "One total line, failures first with their reason, passes folded into one line."

function Window({ make }: { readonly make: () => ChromeView }) {
  const { view, actions } = useFixture(make)
  return <PartScope width="44rem" height="36rem"><ChecksWindow view={view} actions={actions} /></PartScope>
}
export default function Results() { return <Window make={checksView} /> }
export function Running() { return <Window make={checksRunningView} /> }
