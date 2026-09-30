import { MarkPin } from "./MarkPin"
import { PartScope } from "../fixtures/PartScope"

export const name = "Mark pin"
export const note = "One mark's glyph: a teardrop for a click, a tab for a box. White, a dark ring and a dark letter on any product colour."

const row = { display: "flex", gap: "1.2rem", alignItems: "center", padding: "1rem", background: "#000" } as const
export default function Kinds() {
  return <PartScope><span style={row}>
    <MarkPin letter="A" kind="Point" location="Located" />
    <MarkPin letter="B" kind="Region" location="Located" />
    <MarkPin letter="C" kind="Point" location="Lost" />
    <MarkPin letter="D" kind="Point" location="Unresolved" />
  </span></PartScope>
}
export function OnWhite() {
  return <PartScope><span style={{ ...row, background: "#fff1e8" }}>
    <MarkPin letter="A" kind="Point" location="Located" />
    <MarkPin letter="AB" kind="Region" location="Located" />
  </span></PartScope>
}
export function Sizes() {
  return <PartScope><span style={row}>
    <MarkPin letter="A" kind="Point" location="Located" size="frame" />
    <MarkPin letter="A" kind="Point" location="Located" size="thumb" />
    <MarkPin letter="A" kind="Point" location="Located" size="inline" />
  </span></PartScope>
}
