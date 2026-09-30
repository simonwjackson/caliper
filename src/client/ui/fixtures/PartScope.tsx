import type { ReactNode } from "react"
import "../tokens.css"
import "../atoms/atoms.css"
import "../darkroom.css"

/**
 * The preview scope of a region part: the chrome's tokens, type and room
 * colour around one region, at the width the region is given in the chrome.
 * It is not a component of the chrome; the coverage gate leaves it out.
 */
export function PartScope({ children, width, height }: { readonly children: ReactNode; readonly width?: string; readonly height?: string }) {
  return <div className="dr-scope" style={{ padding: "1rem", minHeight: "100%", background: "var(--dr-room)", display: "grid", alignContent: "start" }}>
    <div style={{ width, height, position: "relative", display: "grid", minHeight: 0 }}>{children}</div>
  </div>
}
