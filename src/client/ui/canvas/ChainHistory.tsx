import type { ChainStepView, ChromeActions } from "../contract"
import { CAL } from "../hooks"
import "../tokens.css"
import "./chain.css"

/**
 * A chain's history, unfolded (plan decisions 11 and 13): every take it has
 * had, oldest first. A take that exists opens in the pair when you pick it.
 * A discarded take is struck through and does nothing: its record is gone.
 */
export function ChainHistory({ chain, steps, onTake }: {
  readonly chain: string; readonly steps: readonly ChainStepView[]; readonly onTake: ChromeActions["onTake"]
}) {
  return <ol className="dr-chain__history" aria-label="Takes in this chain, oldest first">
    {steps.map((step, index) => <li key={`${index}:${step.take}`}>
      {step._tag === "Present"
        ? <button type="button" className="dr-chain__step" data-cal={CAL.chainStep} data-chain={chain} data-take={step.take}
          aria-current={step.selected || undefined} onClick={() => onTake(step.take)}>{step.label}</button>
        : <span className="dr-chain__step dr-chain__step--gone" data-cal={CAL.chainStep} data-chain={chain} data-take={step.take}
          aria-disabled="true" title="Discarded: it cannot be opened"><s>{step.label}</s></span>}
    </li>)}
  </ol>
}
