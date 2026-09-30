import type { AcceptFlag } from "../contract"
import type { CalHook } from "../hooks"
import "../tokens.css"
import "./atoms.css"

/**
 * An accept flag (plan decision 12): the take was made before a later accept
 * that touched its part or one of its files, so accepting it can undo that
 * accept. It warns in the warn colour and never blocks.
 *
 * `Fold` is one line that opens to its reason, by click, tap or keyboard, for
 * the chain head where room is short. A dotted underline says it opens; a
 * chevron would push the line past one RG353M frame's width. `Full` writes the reason under the line,
 * for the take record. A current take has no flag and draws nothing.
 */
export function Flag({ flag, variant, hook }: { readonly flag: AcceptFlag; readonly variant: "Fold" | "Full"; readonly hook?: CalHook }) {
  if (flag._tag === "Current") return null
  if (variant === "Full") return <p className="dr-flag dr-flag--full" data-cal={hook} data-take={flag.take} role="note">
    <b className="dr-flag__label">{flag.label}</b><span className="dr-flag__detail">{flag.detail}</span>
  </p>
  return <details className="dr-flag dr-flag--fold" data-cal={hook} data-take={flag.take}>
    <summary className="dr-flag__label" title={flag.detail}>{flag.label}</summary>
    <p className="dr-flag__detail">{flag.detail}</p>
  </details>
}
