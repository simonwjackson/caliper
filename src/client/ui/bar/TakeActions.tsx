import type { ChromeActions, TakeSummary } from "../contract"
import { CAL } from "../hooks"
import { Button } from "../atoms/Button"
import { Icon } from "../atoms/Icon"
import "../tokens.css"
import "./bar.css"

/**
 * What you can do with one take: Accept and Discard, and Stop while its agent
 * works. A running take cannot be accepted yet; Accept stays in place,
 * disabled with the reason, so the row does not jump when the agent stops.
 * An alternate is applied from its review, not accepted here.
 */
export function TakeActions({ take, actions, named = true }: { readonly take: TakeSummary; readonly actions: ChromeActions; readonly named?: boolean }) {
  const running = take.run._tag === "Running"
  return <div className="dr-take-actions" data-take={take.id} role="group" aria-label={`Take ${take.id}`}>
    {named && <span className="dr-take-actions__name"><b>Take {take.id}</b>{running && <span className="dr-take-actions__run"><i className="dr-dot dr-dot--running" aria-hidden="true" />Working</span>}</span>}
    {running && <Button hook={CAL.stop} take={take.id} availability={take.stop} onClick={() => actions.onStop(take.id)}><Icon name="stop" />Stop</Button>}
    {take.kind === "Experiment" && <Button hook={CAL.accept} take={take.id} tone={running ? "plain" : "primary"} availability={take.accept} onClick={() => actions.onAccept(take.id)}>Accept</Button>}
    <Button hook={CAL.discard} take={take.id} availability={take.discard} onClick={() => actions.onDiscard(take.id)}>Discard</Button>
  </div>
}
