import { Literal } from "./Literal"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { knobsView } from "../fixtures/views"

export const name = "Literal"
export const note = "A literal that could be a token; the form names both edits before Caliper makes them."

function One({ id }: { readonly id: string }) {
  const { view, actions } = useFixture(knobsView)
  const literal = view.knobs._tag === "Ready" && view.knobs.literals._tag === "Ready" ? view.knobs.literals.literals.find(item => item.id === id) : undefined
  return <PartScope width="19rem"><ul className="dr-kgroup__list">{literal && <Literal literal={literal} actions={actions} />}</ul></PartScope>
}
export default function Drafting() { return <One id="gap" /> }
export function Closed() { return <One id="radius" /> }
