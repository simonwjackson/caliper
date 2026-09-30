import { DeviceFrame } from "./DeviceFrame"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { errorView, markView, markedView, originalView, runningView, takesView, typeaheadView } from "../fixtures/views"
import { frameGeometry } from "../../device-frame.js"
import type { ChromeView } from "../contract"

export const name = "Device frame"
export const note = "The page at the device's CSS viewport, scaled to its physical width; its name and a dot under it."

function One({ make, take, before }: { readonly make: () => ChromeView; readonly take: string | null; readonly before?: boolean }) {
  const { view, actions } = useFixture(make)
  const frame = view.canvas._tag === "Frames" ? view.canvas.frames.find(item => item.take === take) : undefined
  const geometry = frameGeometry(view.device, view.pxPerMm, { width: 10_000, height: 10_000 })
  return <PartScope width={`${geometry.width}px`}>{frame && <DeviceFrame frame={frame} geometry={geometry} css={{ width: view.device.cssWidth, height: view.device.cssHeight }} actions={actions} markup={view.markup} before={before} />}</PartScope>
}
export default function Focused() { return <One make={takesView} take="6" /> }
export function RealFiles() { return <One make={takesView} take={null} /> }
export function Working() { return <One make={runningView} take="6" /> }
export function Failed() { return <One make={errorView} take={null} /> }
export function Marking() { return <One make={markView} take="6" /> }
export function LostMark() { return <One make={markedView} take="3" /> }
/** A chain's parent: the before of its pair, at 78 %. */
export function Parent() { return <One make={takesView} take="1" before /> }
/** Phase 6: the real files in mark mode, with 0A and 0B. */
export function RealFilesMarked() { return <One make={originalView} take={null} /> }
/** Phase 6: the note at 6B under its frame, offering marks to point to. */
export function TypeAhead() { return <One make={typeaheadView} take="6" /> }
