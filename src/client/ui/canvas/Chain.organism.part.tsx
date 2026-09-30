import type { CSSProperties } from "react"
import { Chain } from "./Chain"
import { PartScope } from "../fixtures/PartScope"
import { useFixture } from "../fixtures/useFixture"
import { chainHistoryView, chainsAcceptedView, takesView } from "../fixtures/views"
import { frameGeometry } from "../../device-frame.js"
import type { ChromeView } from "../contract"

export const name = "Chain"
export const note = "One chain of takes: its head, its history when unfolded, and the pair, the parent at 78 % then the shown take."

/** The chain at `index` of a fixture's canvas, in a frames grid of its own, with or without room for the pair. */
function One({ make, index, pairs }: { readonly make: () => ChromeView; readonly index: number; readonly pairs: boolean }) {
  const { view, actions } = useFixture(make)
  const canvas = view.canvas._tag === "Frames" ? view.canvas : null
  const chain = canvas?.chains[index]
  const frames = new Map(canvas?.frames.map(frame => [frame.key, frame]))
  const shown = chain ? frames.get(chain.shown) : undefined
  const geometry = frameGeometry(view.device, view.pxPerMm, { width: 10_000, height: 10_000 })
  const style = { "--dr-col": `${geometry.width}px` } as CSSProperties
  return <PartScope width={`${pairs && chain?.parent ? geometry.width * 2 + 40 : geometry.width}px`}>
    {chain && shown && <div className="dr-frames" data-bands="" style={style}>
      <Chain chain={chain} shown={shown} parent={chain.parent ? frames.get(chain.parent) ?? null : null} pairs={pairs}
        geometry={geometry} css={{ width: view.device.cssWidth, height: view.device.cssHeight }} actions={actions} markup={view.markup} />
    </div>}
  </PartScope>
}
export default function Pair() { return <One make={takesView} index={0} pairs /> }
export function Flagged() { return <One make={takesView} index={2} pairs /> }
export function HistoryOpen() { return <One make={chainHistoryView} index={0} pairs /> }
export function NoRoom() { return <One make={takesView} index={0} pairs={false} /> }
export function NoRoomParent() { return <One make={chainsAcceptedView} index={2} pairs={false} /> }
