import { Panel } from "./Panel"
import { PartScope } from "../fixtures/PartScope"

export const name = "Panel"
export const note = "An opaque card with one edge: a header, an optional close, and a body that scrolls."

export default function Card() {
  return <PartScope width="21rem" height="14rem">
    <Panel label="Example" title="Knobs" sub="Game Detail, Default" onClose={() => undefined}>
      <p style={{ padding: ".9rem 1rem", color: "var(--dr-ink-2)" }}>The body scrolls inside the card; the page never scrolls.</p>
    </Panel>
  </PartScope>
}
export function NoClose() {
  return <PartScope width="16.5rem" height="10rem">
    <Panel label="Parts" title="@korri/pico" sub="52 parts"><p style={{ padding: ".9rem 1rem" }}>Docked parts panel.</p></Panel>
  </PartScope>
}
