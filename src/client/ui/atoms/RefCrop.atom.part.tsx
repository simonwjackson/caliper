import { RefCrop } from "./RefCrop"
import { PartScope } from "../fixtures/PartScope"
import { frameSource } from "../fixtures/views"

export const name = "Reference crop"
export const note = "A crop of a take's page round one mark, with a ring on a point or a box on an area. A lost mark has no picture."

const page = { width: 640, height: 480 }
const row = { display: "flex", gap: ".8rem", alignItems: "center" } as const
export default function Point() {
  return <PartScope><span style={row}><RefCrop name="0A" crop={{ src: frameSource(), viewport: page, rect: { x: 205, y: 341, width: 0, height: 0 } }} /></span></PartScope>
}
export function Area() {
  return <PartScope><span style={row}><RefCrop name="6B" crop={{ src: frameSource("hue-rotate(160deg)"), viewport: page, rect: { x: 141, y: 77, width: 166, height: 125 } }} /></span></PartScope>
}
export function Large() {
  return <PartScope><span style={row}><RefCrop name="5A" width={128} height={96} crop={{ src: frameSource("hue-rotate(-30deg) brightness(.9)"), viewport: page, rect: { x: 448, y: 307, width: 0, height: 0 } }} /></span></PartScope>
}
export function NoPicture() {
  return <PartScope><span style={row}><RefCrop name="3A" crop={null} /></span></PartScope>
}
