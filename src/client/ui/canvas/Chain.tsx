import { useId } from "react"
import type { ChainView, ChromeActions, FrameView, MarkupView } from "../contract"
import type { FrameGeometry } from "../../device-frame.js"
import { CAL } from "../hooks"
import { ChainHead } from "./ChainHead"
import { ChainHistory } from "./ChainHistory"
import { DeviceFrame } from "./DeviceFrame"
import "../tokens.css"
import "./canvas.css"
import "./chain.css"

export type ChainProps = {
  readonly chain: ChainView
  /** The frames `chain.shown` and `chain.parent` name. */
  readonly shown: FrameView
  readonly parent: FrameView | null
  /** Whether two frames and a gap fit the canvas at true size (`pairFits`). */
  readonly pairs: boolean
  readonly geometry: FrameGeometry
  readonly css: { readonly width: number; readonly height: number }
  readonly actions: ChromeActions
  readonly markup?: MarkupView
}

/**
 * One chain of takes on the canvas (plan decisions 11 to 13, decision 35):
 * its head, its history when unfolded, and the pair, the parent at 78 % then
 * the shown take. It spans three rows of the canvas grid, so heads, histories
 * and frames line up across a band, and two columns when it holds a pair, so
 * the gap inside a pair is the gap between chains.
 *
 * When the pair does not fit, the chain takes one column and draws the frame
 * core names; the other stays mounted and hidden, so a swap or a resize keeps
 * the state you reached in it.
 */
export function Chain({ chain, shown, parent, pairs, geometry, css, actions, markup }: ChainProps) {
  const id = useId()
  const solo = !pairs && parent !== null
  const frame = { geometry, css, actions, markup }
  return <div className="dr-chain" role="group" aria-labelledby={id} data-cal={CAL.chain} data-chain={chain.id}
    data-span={parent && pairs ? 2 : 1} data-solo={solo ? chain.solo : undefined} data-flagged={chain.flag._tag === "Before" || undefined}>
    <ChainHead chain={chain} id={id} parentTake={parent?.take ?? null} solo={solo} onHistory={actions.onChainHistory} onSolo={actions.onChainSolo} />
    {chain.history._tag === "Open" && <ChainHistory chain={chain.id} steps={chain.history.steps} onTake={actions.onTake} />}
    <div className="dr-chain__pair">
      {parent && <DeviceFrame key={parent.key} frame={parent} before hidden={solo && chain.solo !== "Parent"} {...frame} />}
      <DeviceFrame key={shown.key} frame={shown} hidden={solo && chain.solo === "Parent"} {...frame} />
    </div>
  </div>
}
