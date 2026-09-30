import type { LogEntry } from "../contract"
import "../tokens.css"
import "./side.css"

/** One line of a take's conversation: your prompt, the agent's reply, a tool call, or your own edit. */
export function LogLine({ entry }: { readonly entry: LogEntry }) {
  if (entry._tag === "User") return <li className="dr-log__you"><span className="dr-log__who">You</span><p>{entry.text}</p>
    {entry.images.length > 0 && <span className="dr-log__images">{entry.images.map(image => <a key={image.url} href={image.url} target="_blank" rel="noopener"><img src={image.url} alt={image.name} /></a>)}</span>}</li>
  if (entry._tag === "Assistant") return <li className="dr-log__reply"><p>{entry.text}</p></li>
  if (entry._tag === "Edit") return <li className="dr-log__call"><span className="dr-log__tool">you</span><code>{entry.file}</code><span className="dr-log__outcome">edited by hand</span></li>
  return <li className="dr-log__call" data-outcome={entry.outcome} title={entry.detail}>
    <span className="dr-log__tool">{entry.name}</span><code>{entry.subject}</code>
    <span className="dr-log__outcome">{entry.outcome === "Running" ? <><i className="dr-dot dr-dot--running" aria-hidden="true" />working</> : entry.outcome === "Failed" ? `failed${entry.detail ? `: ${entry.detail}` : ""}` : entry.detail}</span>
  </li>
}
