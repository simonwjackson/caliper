import { useRef } from "react"
import type { ChromeActions, FrameView, MarkupGroup, ReferenceOption } from "../contract"
import { CAL } from "../hooks"
import { useBox } from "../useBox"
import { MarkLayer } from "../canvas/MarkLayer"
import { NoteText } from "../atoms/NoteText"
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
  /**
   * Marks some frame on the canvas shows. A mark in it was placed on this state and device and
   * says nothing more; one outside it says where it was placed. Without it, labels are compared.
   */
  readonly onCanvas?: ReadonlySet<string>
  readonly editing: string | null
  readonly replacing: string | null
  readonly actions: Pick<ChromeActions, "onMarkEdit" | "onMarkNote" | "onMarkRemove" | "onMarkReplace" | "onMarkMode">
  /** Every mark name in the draft, to set apart where the outcome names them ("Pointed to by 6B"). */
  readonly names?: readonly string[]
  /** For the open note: the marks it can point to, and the names their own notes point to. */
  readonly references?: readonly ReferenceOption[]
  readonly referencesOf?: ReadonlyMap<string, readonly string[]>
}

/**
 * One marked take, or the real files, in the draft (decision 35): the page
 * with its marks drawn on, its name, what Send does with it, then each mark
 * with its note. The picture is the page itself, small and inert. A take
 * whose marks were placed on another device or state has no picture that
 * fits them, so it shows a plate that says where they were placed.
 *
 * What Send does is core's sentence: a new take, material for the takes
 * whose notes point here (drawn at 78 %, as a pair's parent is: something to
 * compare with, not the one that changes), or marks that go with the prompt.
 */
export function DraftTake({ group, frame, device, state, onCanvas, editing, replacing, actions, names = [], references, referencesOf }: DraftTakeProps) {
  const thumb = useRef<HTMLDivElement>(null)
  const box = useBox(thumb)
  const shown = frame ? group.marks.filter(mark => frame.marks.some(pin => pin.id === mark.id)) : []
  const scale = box.width > 0 ? box.width / device.width : 0
  const here = (mark: MarkupGroup["marks"][number]) => onCanvas ? onCanvas.has(mark.id) : mark.deviceLabel === device.name && mark.previewLabel === state
  const where = (mark: MarkupGroup["marks"][number]) => here(mark) ? null : `Placed on ${mark.previewLabel}, ${mark.deviceLabel}`
  const take = group.source.take
  const [title, ...rest] = group.label.split(" · ")
  // A lost mark's reason already shows under that mark; the take lists only the rest, such as a running agent.
  const reasons = group.decision._tag === "Blocked"
    ? group.decision.reasons.filter(reason => !group.marks.some(mark => mark.location._tag !== "Located" && reason.includes(mark.location.reason)))
    : []
  return <li className="dr-dtake" data-take={take} data-created={group.source.created} data-decision={group.decision._tag} data-outcome={group.outcome._tag} aria-label={group.label}
    data-lost={group.marks.some(mark => mark.location._tag !== "Located") || undefined}>
    <div ref={thumb} className="dr-dtake__thumb" style={{ aspectRatio: `${device.width} / ${device.height}` }}>
      {frame && shown.length > 0
        ? <>
          <span className="dr-dtake__clip">{scale > 0 && <iframe className="dr-dtake__page" src={frame.src} title={take === "0" ? "The real files, as marked" : `Take ${take}, as marked`} tabIndex={-1} aria-hidden="true" loading="lazy"
            width={device.width} height={device.height} style={{ width: device.width, height: device.height, transform: `scale(${scale})` }} />}</span>
          {scale > 0 && <MarkLayer marks={shown} scale={scale} css={device} take={take} size="thumb" />}
        </>
        : <p className="dr-dtake__plate">Placed on {[...new Set(group.marks.map(mark => mark.deviceLabel))].join(" and ")}</p>}
    </div>
    <div className="dr-dtake__head">
      <b>{title}</b>{rest.length > 0 && <span className="dr-dtake__name">{rest.join(" · ")}</span>}
      {group.decision._tag === "Blocked" && <span className="dr-dtake__will" data-decision="Blocked">waits</span>}
    </div>
    <p className="dr-dtake__outcome" data-cal={CAL.draftOutcome} data-outcome={group.outcome._tag}><NoteText text={group.outcome.label} names={names} /></p>
    {reasons.length > 0 && <ul className="dr-dtake__reasons">{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
    <ul className="dr-dtake__marks">
      {group.marks.map(mark => <DraftMark key={mark.id} mark={mark} where={where(mark)} editing={editing === mark.id} replacing={replacing === mark.id} take={take} actions={actions}
        references={editing === mark.id ? references : undefined} referencesOf={editing === mark.id ? referencesOf : undefined} />)}
    </ul>
  </li>
}
