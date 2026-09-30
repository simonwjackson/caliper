import { Icon } from "./Icon"
import type { IconName } from "./Icon"
import { PartScope } from "../fixtures/PartScope"

export const name = "Icon"
export const note = "Line icons in currentColor. The chevron is drawn in CSS."

const NAMES: readonly IconName[] = ["mark", "parts", "preview", "takes", "code", "knobs", "checks", "calibrate", "more", "clip", "close", "stop", "up", "down", "chevron", "chevron-down"]

export default function Every() {
  return <PartScope><span style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "center", color: "var(--dr-ink-2)" }}>
    {NAMES.map(item => <span key={item} title={item}><Icon name={item} /></span>)}
  </span></PartScope>
}
