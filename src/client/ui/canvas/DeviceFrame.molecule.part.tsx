import { DeviceFrame } from "./DeviceFrame"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { errorView, runningView, takesView } from "../fixtures/views"
import { frameGeometry } from "../../device-frame.js"
import type { ChromeView } from "../contract"

export const name = "Device frame"
export const note = "The page at the device's CSS viewport, scaled to its physical width; its name and a dot under it."

function One({ make, take }: { readonly make: () => ChromeView; readonly take: string | null }) {
  const { view, actions } = useFixture(make)
  const frame = view.canvas._tag === "Frames" ? view.canvas.frames.find(item => item.take === take) : undefined
  const geometry = frameGeometry(view.device, view.pxPerMm, { width: 10_000, height: 10_000 })
  return <PartScope width={`${geometry.width}px`}>{frame && <DeviceFrame frame={frame} geometry={geometry} css={{ width: view.device.cssWidth, height: view.device.cssHeight }} actions={actions} />}</PartScope>
}
export default function Focused() { return <One make={takesView} take="6" /> }
export function RealFiles() { return <One make={takesView} take={null} /> }
export function Working() { return <One make={runningView} take="6" /> }
export function Failed() { return <One make={errorView} take={null} /> }
