import { MarkSurface } from "./MarkSurface"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { frameSource, markView } from "../fixtures/views"

export const name = "Mark surface"
export const note = "The clear layer over a frame in mark mode: a click places a pin, a drag a box. Tab reaches Pin and Area for the keyboard."

export default function Marking() {
  const { view, actions } = useFixture(markView)
  const css = { width: view.device.cssWidth, height: view.device.cssHeight }
  const scale = 0.5
  return <PartScope width={`${css.width * scale + 16}px`}>
    <div className="dr-frame" data-marking="" style={{ padding: 8 }}>
      <div className="dr-frame__mount" style={{ width: css.width * scale, height: css.height * scale }}>
        <div className="dr-frame__screen" style={{ width: css.width * scale, height: css.height * scale }}>
          <iframe className="dr-frame__page" title="Game Detail" src={frameSource()} width={css.width} height={css.height} style={{ width: css.width, height: css.height, transform: `scale(${scale})` }} />
        </div>
        <MarkSurface frameKey="6@2026-09-29T13:06" label="Take 6" css={css} onPoint={actions.onMarkPoint} onRegion={actions.onMarkRegion} />
      </div>
    </div>
  </PartScope>
}
