import type { ReactNode } from "react"
import "../tokens.css"
import "../atoms/atoms.css"
import "../darkroom.css"

/**
 * The preview scope of a region part: the chrome's tokens, type and room
 * colour around one region, at the width the region is given in the chrome,
 * but never wider than the frame. Caliper's devices are handhelds, so a desk
 * region such as the composer bar shows at the device's width, as it would in
 * a narrow chrome, instead of spilling past the screen.
 * It is not a component of the chrome; the coverage gate leaves it out.
 */
export function PartScope({ children, width, height }: { readonly children: ReactNode; readonly width?: string; readonly height?: string }) {
  return <div className="dr-scope" style={{ padding: "1rem", minHeight: "100%", background: "var(--dr-room)", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", alignContent: "start" }}>
    <div style={{ width, maxWidth: "100%", height, position: "relative", display: "grid", minHeight: 0, minWidth: 0 }}>{children}</div>
  </div>
}
