import { MarkLayer } from "./MarkLayer"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { frameSource, markView, markedView, originalView, referencesView } from "../fixtures/views"
import type { ChromeView } from "../contract"

export const name = "Mark layer"
export const note = "A take's marks over its page: pins on clicks, boxes on drags, a hollow pin where the element is gone."

function Layer({ make, take, pressable = true }: { readonly make: () => ChromeView; readonly take: string; readonly pressable?: boolean }) {
  const { view, actions } = useFixture(make)
  const frame = view.canvas._tag === "Frames" ? view.canvas.frames.find(item => item.take === (take === "0" ? null : take)) : undefined
  const notes = view.markup._tag === "Ready" ? new Map(view.markup.groups.flatMap(group => group.marks.map(mark => [mark.id, mark] as const))) : undefined
  const scale = 0.5
  const css = { width: view.device.cssWidth, height: view.device.cssHeight }
  const current = view.markup._tag === "Ready" && view.markup.editor._tag === "Open" ? view.markup.editor.id : null
  return <PartScope width={`${css.width * scale}px`}>
    <div style={{ position: "relative", width: css.width * scale, height: css.height * scale, background: "#000" }}>
      <iframe title="Game Detail" src={frameSource()} style={{ position: "absolute", border: 0, width: css.width, height: css.height, transform: `scale(${scale})`, transformOrigin: "0 0" }} />
      {frame && <MarkLayer marks={frame.marks} scale={scale} css={css} take={take} current={current} notes={notes} onPick={pressable ? actions.onMarkEdit : undefined} />}
    </div>
  </PartScope>
}
export default function PinAndBox() { return <Layer make={markView} take="6" /> }
export function Lost() { return <Layer make={markedView} take="3" /> }
export function Drawn() { return <Layer make={markedView} take="6" pressable={false} /> }
/** Phase 6: marks on the real files are named 0A and 0B. */
export function RealFiles() { return <Layer make={originalView} take="0" /> }
/** Phase 6: a pin's title reads its note and the marks it points to: "Mark 6B: … like 0A. Points to 0A." */
export function Pointing() { return <Layer make={referencesView} take="6" /> }
