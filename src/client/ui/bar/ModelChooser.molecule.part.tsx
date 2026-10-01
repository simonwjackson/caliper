import { ModelChooser } from "./ModelChooser"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { modelsView } from "../fixtures/views"
import type { ChromeView, ModelsView } from "../contract"

export const name = "Model chooser"
export const note = "The agent line in the New take menu. It unfolds into pi's favorites and a filter over every model the endpoint serves."

function Chooser({ make, unfolded = true, typed = "" }: { readonly make: () => ChromeView; readonly unfolded?: boolean; readonly typed?: string }) {
  const { view, actions } = useFixture(make)
  const agent = view.composer.agent
  if (agent._tag !== "Ready") return null
  return <PartScope width="18rem"><div className="dr-menu dr-split__menu" role="menu" aria-label="New take options" style={{ position: "static" }}>
    <ModelChooser agent={agent} models={view.composer.models} onModels={actions.onModels} onModel={actions.onModel} unfolded={unfolded} typed={typed} />
  </div></PartScope>
}
const ready = (models: Partial<Extract<ModelsView, { _tag: "Ready" }>>) => () => {
  const view = modelsView()
  const base = view.composer.models
  return base._tag === "Ready" ? modelsView({ ...base, ...models }) : view
}

export default function Favorites() { return <Chooser make={modelsView} /> }
export function Folded() { return <Chooser make={modelsView} unfolded={false} /> }
export function Filtering() { return <Chooser make={modelsView} typed="qwen" /> }
export function TypedId() { return <Chooser make={modelsView} typed="qwen3-coder-next" /> }
export function Saving() { return <Chooser make={ready({ choosing: "gpt-oss-120b" })} /> }
export function NoFavorites() { return <Chooser make={ready({ favorites: [] })} /> }
export function NoList() { return <Chooser make={ready({ models: [], problem: "Caliper could not list the endpoint's models. http://127.0.0.1:11434/v1/models answered 404." })} /> }
export function Loading() { return <Chooser make={() => modelsView({ _tag: "Loading" })} /> }
export function Failed() { return <Chooser make={() => modelsView({ _tag: "Failed", reason: "http://127.0.0.1:11434/v1/models did not answer: connection refused." })} /> }
