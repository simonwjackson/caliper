import type { Static } from "typebox"
import type { ModelsView } from "../ui/contract"
import type { ModelsSchema } from "./wire"

type Request = <T>(path: string, data?: object) => Promise<T>
type Choices = Static<typeof ModelsSchema>
const message = (problem: unknown) => problem instanceof Error ? problem.message : String(problem)

/**
 * Owns the model chooser (decision 43): the list the app offers and the
 * choice being saved. The list loads each time the chooser unfolds; a list
 * already shown stays while the new one loads. A choice saves app-wide, and
 * the takes snapshot then names the new model.
 */
export function createModelsController({ request, changed, notify }: { request: Request; changed: () => void; notify: (reason: unknown) => void }) {
  let view: ModelsView = { _tag: "Idle" }
  let epoch = 0
  let destroyed = false
  const publish = (next: ModelsView) => { if (!destroyed) { view = next; changed() } }
  const ready = (choices: Choices, choosing: string | null = null): ModelsView => ({
    _tag: "Ready", current: choices.current, favorites: choices.favorites, models: choices.models, problem: choices.problem ?? "", choosing,
  })
  const load = async () => {
    if (view._tag === "Loading" || view._tag === "Ready" && view.choosing !== null) return
    const mine = ++epoch
    if (view._tag !== "Ready") publish({ _tag: "Loading" })
    try {
      const choices = await request<Choices>("models.json")
      if (mine === epoch) publish(ready(choices))
    } catch (problem) {
      if (mine === epoch) publish({ _tag: "Failed", reason: message(problem) })
    }
  }
  const choose = async (model: string) => {
    const id = model.trim()
    if (!/^\S{1,200}$/.test(id) || view._tag !== "Ready" || view.choosing !== null || id === view.current) return
    const before = view
    const mine = ++epoch
    publish({ ...before, choosing: id })
    try {
      const choices = await request<Choices>("model", { model: id })
      if (mine === epoch) publish(ready(choices))
    } catch (problem) {
      if (mine === epoch) publish({ ...before, choosing: null })
      notify(problem)
    }
  }
  return {
    view: (): ModelsView => view,
    load: () => { void load() },
    choose: (model: string) => { void choose(model) },
    /** The snapshot names the model in use; another tab may have chosen it. */
    receiveCurrent: (model: string | null) => {
      if (model !== null && view._tag === "Ready" && view.choosing === null && view.current !== model) publish({ ...view, current: model })
    },
    destroy: () => { destroyed = true },
  }
}
