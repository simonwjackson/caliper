import type { Connection as ConnectionView } from "../contract"
import { CAL } from "../hooks"
import "../tokens.css"
import "./tools.css"

/** Silent while ready; a quiet line while connecting; a bad line when Vite is gone. What was on screen stays. */
export function Connection({ connection }: { readonly connection: ConnectionView }) {
  const text = connection._tag === "Ready" ? "Connected to Vite" : connection._tag === "Connecting" ? "Connecting to Vite…" : `Vite is not reachable. ${connection.reason}`
  return <p className="dr-connection" data-cal={CAL.connection} data-state={connection._tag} role={connection._tag === "Unreachable" ? "alert" : "status"}>
    {connection._tag !== "Ready" && <i className={`dr-dot ${connection._tag === "Unreachable" ? "dr-dot--bad" : "dr-dot--running"}`} aria-hidden="true" />}{text}
  </p>
}
