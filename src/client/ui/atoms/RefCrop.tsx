import type { ReferenceOption } from "../contract"
import { cropView } from "../references"
import "../tokens.css"
import "./atoms.css"

export type RefCropProps = {
  /** Where the mark is: its page, the page's CSS viewport and the mark's rect in it. Null draws no picture. */
  readonly crop: ReferenceOption["crop"]
  /** The mark's name, for the page's title. */
  readonly name: string
  /** The crop's drawn size in px. */
  readonly width?: number
  readonly height?: number
}

/**
 * A crop of the page round a mark (decision 35: the type-ahead shows a crop
 * of each mark). The page is its own small, inert frame, scaled so the mark
 * sits in view with room round it; a ring or a box shows where the mark is.
 * With no crop, a mark that is lost, the plate is dashed and says so.
 */
export function RefCrop({ crop, name, width = 64, height = 48 }: RefCropProps) {
  if (!crop) return <span className="dr-crop dr-crop--none" style={{ width, height }}>No picture</span>
  const view = cropView(crop.viewport, crop.rect, { width, height })
  const point = crop.rect.width <= 0 || crop.rect.height <= 0
  return <span className="dr-crop" style={{ width, height }} aria-hidden="true">
    <iframe className="dr-crop__page" src={crop.src} title={`Where ${name} is`} tabIndex={-1} loading="lazy"
      width={crop.viewport.width} height={crop.viewport.height}
      style={{ width: crop.viewport.width, height: crop.viewport.height, transform: `translate(${-view.x * view.scale}px, ${-view.y * view.scale}px) scale(${view.scale})` }} />
    {point
      ? <i className="dr-crop__point" style={{ left: view.mark.x, top: view.mark.y }} />
      : <i className="dr-crop__region" style={{ left: view.mark.x, top: view.mark.y, width: view.mark.width, height: view.mark.height }} />}
  </span>
}
