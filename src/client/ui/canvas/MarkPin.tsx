import "../tokens.css"
import "./marks.css"

export type MarkPinProps = {
  readonly letter: string
  /** A click makes a teardrop pin; a drag makes a box, whose letter sits on a tab. */
  readonly kind: "Point" | "Region"
  /** Lost is a hollow dashed pin. Unresolved is dimmed until core has looked for the element. */
  readonly location: "Located" | "Lost" | "Unresolved"
  /** Frame: on a frame at true size. Thumb: on a draft thumbnail. Inline: in a line of text. */
  readonly size?: "frame" | "thumb" | "inline"
}

/**
 * The glyph of one mark (decision 35): two-tone, a white fill, a dark ring
 * and a dark letter. Marks sit on the product, not on the chrome, so they
 * keep these colours in both schemes and read on a white part and a black
 * one. The agent's picture draws the same glyph.
 */
export function MarkPin({ letter, kind, location, size = "frame" }: MarkPinProps) {
  return <span className="dr-pin" data-kind={kind} data-location={location} data-size={size} aria-hidden="true"><span className="dr-pin__letter">{letter}</span></span>
}
