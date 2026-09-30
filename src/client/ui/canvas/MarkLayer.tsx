import type { CSSProperties } from "react"
import type { DraftMarkView, MarkPin as MarkPinView } from "../contract"
import { CAL } from "../hooks"
import { MarkPin } from "./MarkPin"
import "../tokens.css"
import "./marks.css"

export type MarkLayerProps = {
  readonly marks: readonly MarkPinView[]
  /** Drawn px per device CSS px. A mark's rect is in the device's CSS viewport. */
  readonly scale: number
  /** The device's CSS viewport. A pin outside it is drawn at the nearest edge, so it stays in reach. */
  readonly css: { readonly width: number; readonly height: number }
  /** The take number, for each mark's name: 6 and B make 6B. */
  readonly take: string
  /** Open a mark's note. Without it the marks are drawn, not pressed: on a draft thumbnail. */
  readonly onPick?: (id: string) => void
  /** The mark whose note is open. */
  readonly current?: string | null
  readonly size?: "frame" | "thumb"
  /** Each mark's note and the names it points to, from the draft. A pin's title reads them. */
  readonly notes?: ReadonlyMap<string, Pick<DraftMarkView, "note" | "references">>
}

const TAB_H = 18
const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value))
const listed = (names: readonly string[]) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
/** "Mark 6B: Too heavy, like 0A. Points to 0A." A lost mark adds its reason. */
function describe(mark: MarkPinView, name: string, notes?: MarkLayerProps["notes"]) {
  const drafted = notes?.get(mark.id)
  const note = drafted?.note.trim() ?? ""
  const said = [
    note && !/[.!?]$/.test(note) ? `${note}.` : note,
    drafted?.references.length ? `Points to ${listed(drafted.references)}.` : "",
    mark.location._tag === "Located" ? "" : mark.location.reason,
  ].filter(Boolean)
  return said.length ? `Mark ${name}: ${said.join(" ")}` : `Mark ${name}`
}

/**
 * The marks on one screen: a pin on a click, a box on a drag. A pin's tip
 * is at the centre of its rect; a point mark's rect has no size. A box's
 * letter sits on a tab above its top-left corner, or inside it when the box
 * starts at the screen's top edge. Only the pin and the tab take a press, so
 * a click inside a box can still place a new mark.
 */
export function MarkLayer({ marks, scale, css, take, onPick, current = null, size = "frame", notes }: MarkLayerProps) {
  return <div className="dr-marks">
    {marks.map(mark => {
      const name = `${take}${mark.letter}`
      const location = mark.location._tag
      const glyph = <MarkPin letter={mark.letter} kind={mark.kind} location={location} size={size} />
      const common = { "data-mark-id": mark.id, "data-location": location, "data-current": current === mark.id || undefined, "data-size": size }
      if (mark.kind === "Point") {
        const style: CSSProperties = { left: clamp(mark.rect.x + mark.rect.width / 2, css.width) * scale, top: clamp(mark.rect.y + mark.rect.height / 2, css.height) * scale }
        return onPick
          ? <button key={mark.id} type="button" className="dr-mark dr-mark--point" style={style} {...common} data-cal={CAL.markPin}
            aria-label={describe(mark, name, notes)} title={describe(mark, name, notes)} onClick={() => onPick(mark.id)}>{glyph}</button>
          : <span key={mark.id} className="dr-mark dr-mark--point" style={style} {...common}>{glyph}</span>
      }
      const x = clamp(mark.rect.x, css.width), y = clamp(mark.rect.y, css.height)
      const style: CSSProperties = {
        left: x * scale, top: y * scale,
        width: Math.max(4, (clamp(mark.rect.x + mark.rect.width, css.width) - x) * scale), height: Math.max(4, (clamp(mark.rect.y + mark.rect.height, css.height) - y) * scale),
      }
      return <div key={mark.id} className="dr-mark dr-mark--region" style={style} {...common} data-inside={y * scale < TAB_H || undefined}>
        {onPick
          ? <button type="button" className="dr-mark__tab" data-cal={CAL.markPin} data-mark-id={mark.id} aria-label={describe(mark, name, notes)} title={describe(mark, name, notes)} onClick={() => onPick(mark.id)}>{glyph}</button>
          : <span className="dr-mark__tab">{glyph}</span>}
      </div>
    })}
  </div>
}
