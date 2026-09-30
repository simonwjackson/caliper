import type { ChainView, ChromeActions } from "../contract"
import { CAL } from "../hooks"
import { Flag } from "../atoms/Flag"
import "../tokens.css"
import "./chain.css"

/**
 * The words of a chain's heading, from core's label, for example
 * "7 ← from 3 (1 discarded)": the take, where it came from, and the gap. The
 * policy writes the take first; any other label is drawn whole.
 */
function words(label: string, take: string): { readonly from: string; readonly gap: string } | null {
  if (!label.startsWith(take)) return null
  const rest = label.slice(take.length).trim()
  const gap = /\([^()]*\)$/.exec(rest)
  return { from: (gap ? rest.slice(0, gap.index) : rest).trim(), gap: gap?.[0] ?? "" }
}

export type ChainHeadProps = {
  readonly chain: ChainView
  /** The heading's id: the chain's group takes its name from it. */
  readonly id: string
  /** The parent's take number, for the swap's words. */
  readonly parentTake: string | null
  /** The pair does not fit the canvas, so one frame shows and the swap is here. */
  readonly solo: boolean
  readonly onHistory: ChromeActions["onChainHistory"]
  readonly onSolo: ChromeActions["onChainSolo"]
}

/**
 * A chain's head (decision 35): the take in bold, where it came from, and the
 * gap in the dimmest ink, as "6 ← from 1 (1 discarded)". The accept flag sits
 * at the right in the warn colour and opens to its reason. The history toggle
 * says how many takes the chain has had. When the pair does not fit, the
 * swap to the other frame is here too, one tap away.
 */
export function ChainHead({ chain, id, parentTake, solo, onHistory, onSolo }: ChainHeadProps) {
  const said = words(chain.label, chain.take)
  const history = chain.history
  const swap = solo && chain.parent !== null
  return <div className="dr-chain__head">
    <h2 id={id} className="dr-chain__label">
      {said ? <>
        <b>{chain.take}</b>
        {said.from && <>{" "}<span className="dr-chain__from">{said.from}</span></>}
        {said.gap && <>{" "}<span className="dr-chain__gap">{said.gap}</span></>}
      </> : chain.label}
    </h2>
    <span className="dr-chain__spacer" aria-hidden="true" />
    <Flag flag={chain.flag} variant="Fold" hook={CAL.chainFlag} />
    {(swap || history._tag !== "None") && <span className="dr-chain__aside">
      {swap && <button type="button" className="dr-chain__toggle dr-chain__swap" data-cal={CAL.chainSolo} data-chain={chain.id} data-solo={chain.solo}
        title="The pair does not fit at true size, so one frame shows"
        onClick={() => onSolo(chain.id, chain.solo === "Shown" ? "Parent" : "Shown")}>
        {chain.solo === "Shown" ? parentTake ? `Show take ${parentTake}` : "Show the parent" : `Show take ${chain.take}`}
      </button>}
      {history._tag !== "None" && <button type="button" className="dr-chain__toggle" data-cal={CAL.chainHistory} data-chain={chain.id}
        aria-expanded={history._tag === "Open"} onClick={() => onHistory(chain.id, history._tag !== "Open")}>
        {history.label}<i className="dr-chev" aria-hidden="true" />
      </button>}
    </span>}
  </div>
}
