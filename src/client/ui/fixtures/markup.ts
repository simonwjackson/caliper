/**
 * Local take markup for the gallery and the part files (decision 18): a list
 * of marks turned into the view a real app would show. It is not core. It
 * stores nothing, resolves no selectors and reads no frame document; a mark's
 * rect and location are explicit inputs. The Send label and each take's
 * decision come from the shared Send policy, as core's do.
 */
import type { Availability, ChromeView, DraftMarkView, FrameView, MarkMode, MarkPin, MarkRect, MarkupGroup, MarkupSend, MarkupView } from "../contract"
import { planSend } from "../../../takes/send-plan.js"
import type { MarkLocation, TakeIdentity } from "../../../takes/send-plan.js"

/** One mark as the fixtures hold it. `frame` is the key of the frame that shows it, or null when no frame on the canvas does. */
export type LocalMark = {
  readonly id: string; readonly source: TakeIdentity; readonly frame: string | null
  readonly letter: string; readonly kind: "Point" | "Region"; readonly rect: MarkRect; readonly location: MarkLocation
  readonly note: string; readonly previewLabel: string; readonly deviceLabel: string
}
export type MarkupState = {
  readonly revision: number; readonly mode: MarkMode; readonly draftOpen: boolean; readonly editor: string | null
  /** Replaces the policy's Send state, for Sending and Failed. */
  readonly send?: MarkupSend
}

const enabled: Availability = { _tag: "Enabled" }

/** A to Z, then AA, AB and so on (planner choice 5). A letter in use is never given again. */
export function nextLetter(used: readonly string[]): string {
  for (let index = 0; ; index++) {
    let letter = ""
    let rest = index
    do { letter = String.fromCharCode(65 + (rest % 26)) + letter; rest = Math.floor(rest / 26) - 1 } while (rest >= 0)
    if (!used.includes(letter)) return letter
  }
}

/** The take identity a fixture frame stands for: its take number and the creation time in its key. */
export function frameIdentity(frame: FrameView): TakeIdentity | null {
  if (!frame.take) return null
  const at = frame.key.indexOf("@")
  const created = at < 0 ? Number.NaN : Date.parse(`${frame.key.slice(at + 1)}Z`)
  return { take: frame.take, created: Number.isNaN(created) ? 0 : created }
}

const frames = (view: ChromeView): readonly FrameView[] => view.canvas._tag === "Frames" ? view.canvas.frames : []

/** The marks a view holds, read back from its draft and frames. */
export function readMarks(view: ChromeView): LocalMark[] {
  if (view.markup._tag !== "Ready") return []
  return view.markup.groups.flatMap(group => group.marks.map(mark => ({
    id: mark.id, source: group.source, frame: frames(view).find(frame => frame.marks.some(pin => pin.id === mark.id))?.key ?? null,
    letter: mark.letter, kind: mark.kind, rect: mark.rect, location: mark.location, note: mark.note, previewLabel: mark.previewLabel, deviceLabel: mark.deviceLabel,
  })))
}
export function markupState(view: ChromeView): MarkupState {
  if (view.markup._tag !== "Ready") return { revision: 0, mode: { _tag: "Off" }, draftOpen: false, editor: null }
  const { revision, mode, draftOpen, editor, send } = view.markup
  return { revision, mode, draftOpen, editor: editor._tag === "Open" ? editor.id : null, ...(send._tag === "Idle" ? {} : { send }) }
}

/**
 * Put the marks into the view: each frame's pins, and the draft grouped by
 * take with the Send policy's decision. While Send runs, nothing can change.
 */
export function withMarkup(view: ChromeView, marks: readonly LocalMark[], state: MarkupState): ChromeView {
  const sending = state.send?._tag === "Sending"
  const locked: Availability = { _tag: "Disabled", reason: "The draft is being sent" }
  const canvas = view.canvas._tag === "Frames" ? { ...view.canvas, frames: view.canvas.frames.map(frame => ({
    ...frame,
    markable: sending && frame.markable._tag === "Enabled" ? locked : frame.markable,
    marks: marks.filter(mark => mark.frame === frame.key).map((mark): MarkPin => ({ id: mark.id, letter: mark.letter, kind: mark.kind, rect: mark.rect, location: mark.location })),
  })) } : view.canvas
  const takes = frames(view).flatMap(frame => {
    const identity = frameIdentity(frame)
    return identity ? [{ ...identity, kind: "Experiment" as const, run: frame.run ?? { _tag: "Idle" as const } }] : []
  })
  const plan = planSend(marks.map(mark => ({ id: mark.id, name: `${mark.source.take}${mark.letter}`, source: mark.source, location: mark.location })), takes)
  const draftMark = (mark: LocalMark): DraftMarkView => ({
    id: mark.id, letter: mark.letter, kind: mark.kind, rect: mark.rect, location: mark.location,
    name: `${mark.source.take}${mark.letter}`, note: mark.note, previewLabel: mark.previewLabel, deviceLabel: mark.deviceLabel,
    edit: sending ? locked : enabled, remove: sending ? locked : enabled, replace: sending ? locked : enabled,
  })
  const groups: MarkupGroup[] = plan.groups.map(group => ({
    source: group.source, label: `Take ${group.source.take}`,
    marks: marks.filter(mark => group.marks.includes(mark.id)).map(draftMark),
    decision: group.reasons.length ? { _tag: "Blocked", reasons: group.reasons } : { _tag: "Ready" },
  }))
  const open = state.editor ? groups.flatMap(group => group.marks).find(mark => mark.id === state.editor) : undefined
  const send: MarkupSend = state.send ?? { _tag: "Idle", label: plan.label, availability: plan._tag === "Ready" ? enabled : { _tag: "Disabled", reason: plan._tag === "Empty" ? "Add a mark first" : plan.reasons.join(" ") } }
  const markup: MarkupView = {
    _tag: "Ready", revision: state.revision, mode: sending ? { _tag: "Off" } : state.mode, draftOpen: state.draftOpen && groups.length > 0, groups, send,
    editor: open ? { _tag: "Open", id: open.id, name: open.name, note: open.note, edit: open.edit } : { _tag: "Closed" },
  }
  return { ...view, canvas, markup }
}
