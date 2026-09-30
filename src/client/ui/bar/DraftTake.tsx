import { useRef } from "react"
import type { ChromeActions, FrameView, MarkupGroup } from "../contract"
import { useBox } from "../useBox"
import { MarkLayer } from "../canvas/MarkLayer"
import { DraftMark } from "./DraftMark"
import "../tokens.css"
import "./draft.css"

export type DraftTakeProps = {
  readonly group: MarkupGroup
  /** The frame on the canvas that shows this take's marks, when there is one. */
  readonly frame: FrameView | undefined
  /** The device on the canvas and its CSS viewport. */
  readonly device: { readonly name: string; readonly width: number; readonly height: number }
  /** The state on the canvas, to say where a mark from another state was placed. */
  readonly state: string
  readonly editing: string | null
  readonly replacing: string | null
  readonly actions: Pick<ChromeActions, "onMarkEdit" | "onMarkNote" | "onMarkRemove" | "onMarkReplace" | "onMarkMode">
}

/**
 * One marked take in the draft (decision 35): the take with its marks drawn
 * on, its name and what Send does for it, then each mark with its note.
 * The picture is the take's own page, small and inert. A take whose marks
 * were placed on another device or state has no picture that fits them, so
 * it shows a plate that says where they were placed.
 */
export function DraftTake({ group, frame, device, state, editing, replacing, actions }: DraftTakeProps) {
  const thumb = useRef<HTMLDivElement>(null)
  const box = useBox(thumb)
  const shown = frame ? group.marks.filter(mark => frame.marks.some(pin => pin.id === mark.id)) : []
  const scale = box.width > 0 ? box.width / device.width : 0
  const where = (mark: MarkupGroup["marks"][number]) => mark.deviceLabel === device.name && mark.previewLabel === state ? null : `Placed on ${mark.previewLabel}, ${mark.deviceLabel}`
  const take = group.source.take
  // A lost mark's reason already shows under that mark; the take lists only the rest, such as a running agent.
  const reasons = group.decision._tag === "Blocked"
    ? group.decision.reasons.filter(reason => !group.marks.some(mark => mark.location._tag !== "Located" && reason.includes(mark.location.reason)))
    : []
  return <li className="dr-dtake" data-take={take} data-created={group.source.created} data-decision={group.decision._tag} aria-label={group.label}
    data-lost={group.marks.some(mark => mark.location._tag !== "Located") || undefined}>
    <div ref={thumb} className="dr-dtake__thumb" style={{ aspectRatio: `${device.width} / ${device.height}` }}>
      {frame && shown.length > 0
        ? <>
          <span className="dr-dtake__clip">{scale > 0 && <iframe className="dr-dtake__page" src={frame.src} title={`Take ${take}, as marked`} tabIndex={-1} aria-hidden="true" loading="lazy"
            width={device.width} height={device.height} style={{ width: device.width, height: device.height, transform: `scale(${scale})` }} />}</span>
          {scale > 0 && <MarkLayer marks={shown} scale={scale} css={device} take={take} size="thumb" />}
        </>
        : <p className="dr-dtake__plate">Placed on {[...new Set(group.marks.map(mark => mark.deviceLabel))].join(" and ")}</p>}
    </div>
    <div className="dr-dtake__head">
      <b>{take}</b>{frame && <span className="dr-dtake__name">{frame.label}</span>}
      <span className="dr-dtake__will" data-decision={group.decision._tag}>{group.decision._tag === "Ready" ? "→ new take" : "waits"}</span>
    </div>
    {reasons.length > 0 && <ul className="dr-dtake__reasons">{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
    <ul className="dr-dtake__marks">
      {group.marks.map(mark => <DraftMark key={mark.id} mark={mark} where={where(mark)} editing={editing === mark.id} replacing={replacing === mark.id} take={take} actions={actions} />)}
    </ul>
  </li>
}
