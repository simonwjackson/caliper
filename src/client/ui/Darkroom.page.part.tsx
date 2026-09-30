import { useSyncExternalStore, useState } from "react"
import Darkroom from "./Darkroom"
import { FIXTURES } from "./fixtures/views"
import type { FixtureName } from "./fixtures/views"
import { createScenario } from "./fixtures/scenario"

export const name = "Darkroom chrome"
export const note = "The whole chrome with local fixtures: the mockup's states and the three it did not draw."

function Chrome({ fixture }: { readonly fixture: FixtureName }) {
  const [scenario] = useState(() => createScenario(FIXTURES[fixture]()))
  const view = useSyncExternalStore(scenario.subscribe, scenario.getView, scenario.getView)
  return <div style={{ height: "100vh" }}><Darkroom view={view} actions={scenario.actions} /></div>
}
export default function Takes() { return <Chrome fixture="takes" /> }
export function FirstRun() { return <Chrome fixture="empty" /> }
export function Plan() { return <Chrome fixture="plan" /> }
export function Planning() { return <Chrome fixture="planning" /> }
export function Record() { return <Chrome fixture="log" /> }
export function RunningTake() { return <Chrome fixture="running" /> }
export function StoppedTake() { return <Chrome fixture="failedTake" /> }
export function AgentFailed() { return <Chrome fixture="agentFailed" /> }
export function AgentOff() { return <Chrome fixture="agentOff" /> }
export function Knobs() { return <Chrome fixture="knobs" /> }
export function Code() { return <Chrome fixture="code" /> }
export function CodeWatching() { return <Chrome fixture="codeWatching" /> }
export function AllStates() { return <Chrome fixture="grid" /> }
export function Throws() { return <Chrome fixture="error" /> }
export function Checks() { return <Chrome fixture="checks" /> }
export function Calibrate() { return <Chrome fixture="calibrate" /> }
export function Alternate() { return <Chrome fixture="alternate" /> }
export function Unreachable() { return <Chrome fixture="unreachable" /> }
export function Nothing() { return <Chrome fixture="none" /> }
