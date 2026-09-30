import { ChainHistory } from "./ChainHistory"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { ACCEPTED, chainHistoryView, chainsAcceptedView } from "../fixtures/views"
import { readChoices, withChains } from "../fixtures/chains"
import type { ChromeView } from "../contract"

export const name = "Chain history"
export const note = "Every take a chain has had, oldest first: present takes open in the pair, discarded ones are struck and inert."

/** The steps of the chain at `index`, unfolded. */
function Steps({ make, index, width }: { readonly make: () => ChromeView; readonly index: number; readonly width: string }) {
  const { view, actions } = useFixture(make)
  const chain = view.canvas._tag === "Frames" ? view.canvas.chains[index] : undefined
  const history = chain?.history
  return <PartScope width={width}>
    {chain && history && history._tag === "Open" && <ChainHistory chain={chain.id} steps={history.steps} onTake={actions.onTake} />}
  </PartScope>
}
/** After the accept, with the history of 7 from 3 unfolded: 3, then 5 struck, then 7. */
function acceptedOpen(): ChromeView {
  const view = chainsAcceptedView()
  const id = view.canvas._tag === "Frames" ? view.canvas.chains[2]?.id : undefined
  return id ? withChains(view, ACCEPTED, { ...readChoices(view), open: [id] }) : view
}
export default function Branched() { return <Steps make={chainHistoryView} index={0} width="37rem" /> }
export function Narrow() { return <Steps make={chainHistoryView} index={0} width="17.5rem" /> }
export function DiscardedMiddle() { return <Steps make={acceptedOpen} index={2} width="17.5rem" /> }
