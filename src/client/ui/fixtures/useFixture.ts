import { useState, useSyncExternalStore } from "react"
import type { ChromeActions, ChromeView } from "../contract"
import { createScenario } from "./scenario"

/**
 * A part's scenario: a fresh fixture view and the local actions that change
 * it (decision 18). Each mounted part holds its own copy, so two previews of
 * the same part can reach different states in one document.
 */
export function useFixture(make: () => ChromeView): { readonly view: ChromeView; readonly actions: ChromeActions } {
  const [scenario] = useState(() => createScenario(make()))
  const view = useSyncExternalStore(scenario.subscribe, scenario.getView, scenario.getView)
  return { view, actions: scenario.actions }
}
