import { ChainHead } from "./ChainHead"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { chainHistoryView, chainsAcceptedView, takesView } from "../fixtures/views"
import type { ChromeView } from "../contract"

export const name = "Chain head"
export const note = "The take, where it came from and the gap; the accept flag; the history toggle; the swap when the pair does not fit."

/** The head of the chain at `index`, as wide as a pair or as one frame. */
function Head({ make, index, solo }: { readonly make: () => ChromeView; readonly index: number; readonly solo: boolean }) {
  const { view, actions } = useFixture(make)
  const canvas = view.canvas._tag === "Frames" ? view.canvas : null
  const chain = canvas?.chains[index]
  const parent = chain?.parent ? canvas?.frames.find(frame => frame.key === chain.parent)?.take ?? null : null
  return <PartScope width={solo ? "17.5rem" : "37rem"}>
    {chain && <ChainHead chain={chain} id={`head-${chain.id}`} parentTake={parent} solo={solo} onHistory={actions.onChainHistory} onSolo={actions.onChainSolo} />}
  </PartScope>
}
export default function FromParent() { return <Head make={takesView} index={0} solo={false} /> }
export function Alone() { return <Head make={takesView} index={2} solo={false} /> }
export function Open() { return <Head make={chainHistoryView} index={0} solo={false} /> }
export function NoRoom() { return <Head make={takesView} index={0} solo /> }
export function FlaggedNoRoom() { return <Head make={chainsAcceptedView} index={2} solo /> }
