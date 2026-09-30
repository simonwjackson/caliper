import { MarkLayer } from "./MarkLayer"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { frameSource, markView, markedView } from "../fixtures/views"
import type { ChromeView } from "../contract"

export const name = "Mark layer"
export const note = "A take's marks over its page: pins on clicks, boxes on drags, a hollow pin where the element is gone."

function Layer({ make, take, pressable = true }: { readonly make: () => ChromeView; readonly take: string; readonly pressable?: boolean }) {
  const { view, actions } = useFixture(make)
  const frame = view.canvas._tag === "Frames" ? view.canvas.frames.find(item => item.take === take) : undefined
  const scale = 0.5
  const css = { width: view.device.cssWidth, height: view.device.cssHeight }
  const current = view.markup._tag === "Ready" && view.markup.editor._tag === "Open" ? view.markup.editor.id : null
  return <PartScope width={`${css.width * scale}px`}>
    <div style={{ position: "relative", width: css.width * scale, height: css.height * scale, background: "#000" }}>
      <iframe title="Game Detail" src={frameSource()} style={{ position: "absolute", border: 0, width: css.width, height: css.height, transform: `scale(${scale})`, transformOrigin: "0 0" }} />
      {frame && <MarkLayer marks={frame.marks} scale={scale} css={css} take={take} current={current} onPick={pressable ? actions.onMarkEdit : undefined} />}
    </div>
  </PartScope>
}
export default function PinAndBox() { return <Layer make={markView} take="6" /> }
export function Lost() { return <Layer make={markedView} take="3" /> }
export function Drawn() { return <Layer make={markedView} take="6" pressable={false} /> }
