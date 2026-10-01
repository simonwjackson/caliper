/**
 * Local take markup for the gallery and the part files (decision 18): a list
 * of marks turned into the view a real app would show. It is not core. It
 * stores nothing, resolves no selectors and reads no frame document; a mark's
 * rect and location are explicit inputs. The Send label, each group's
 * decision and outcome, and which names a note points to come from the shared
 * Send policy, as core's do.
 *
 * Phase 6: the real files take marks too, named 0A, 0B (plan decision 8).
 * A note can point to a mark on another take or the original (decision 6);
 * a source whose marks are all pointed to makes no take (decision 7). While a
 * prompt is typed, unnamed marks on the shown real files go with it
 * (planner choice 14).
 */
import type { Availability, ChromeView, ComposerView, DraftMarkView, FrameView, MarkMode, MarkPin, MarkRect, MarkupGroup, MarkupOutcome, MarkupSend, MarkupView, ReferenceOption } from "../contract"
import { ORIGINAL, isOriginal, planSend, referencesIn } from "../../../takes/send-plan.js"
import type { MarkLocation, SendPlan, TakeIdentity } from "../../../takes/send-plan.js"

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
/** What a mark on this frame is on: its take, or the original for a frame of the real files (phase 6). */
export function sourceOf(frame: FrameView): TakeIdentity {
  return frameIdentity(frame) ?? ORIGINAL
}
export const sameSource = (left: TakeIdentity, right: TakeIdentity) => left.take === right.take && left.created === right.created
/** A mark's name: take number and letter, 0 for the original. */
export const nameOf = (mark: Pick<LocalMark, "source" | "letter">) => `${mark.source.take}${mark.letter}`
/** "0A", "0A and 0B", "5A, 6B and 7A": core's list of names. */
export const listed = (names: readonly string[]) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`

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
 * Planner choice 14: the marks on the real files that go with a typed prompt
 * when you press New take. They are on a frame of the real files on the
 * canvas, on the device shown, found, and named by no note.
 */
export function goingWithPrompt(view: ChromeView, marks: readonly LocalMark[]): LocalMark[] {
  if (view.plan._tag !== "None" || !view.composer.prompt.trim()) return []
  const names = marks.map(nameOf)
  const named = new Set(marks.flatMap(mark => referencesIn(mark.note, mark.source.take, names)))
  return marks.filter(mark => isOriginal(mark.source) && mark.frame !== null && mark.deviceLabel === view.device.name && mark.location._tag === "Located" && !named.has(nameOf(mark)))
}

/**
 * Put the marks into the view: each frame's pins, the draft grouped by take
 * with the Send policy's decision and outcome, the names each note points to,
 * the open note's type-ahead with a crop of each mark, and which marks go with
 * the prompt. While Send runs, nothing can change.
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
  const names = marks.map(nameOf)
  const referencesOf = (mark: LocalMark) => referencesIn(mark.note, mark.source.take, names)
  const plan = planSend(marks.map(mark => ({ id: mark.id, name: nameOf(mark), note: mark.note, source: mark.source, location: mark.location })), takes)
  const going = goingWithPrompt(view, marks)
  const frameFor = (source: TakeIdentity) => frames(view).find(frame => sameSource(sourceOf(frame), source))
  const draftMark = (mark: LocalMark): DraftMarkView => ({
    id: mark.id, letter: mark.letter, kind: mark.kind, rect: mark.rect, location: mark.location,
    name: nameOf(mark), note: mark.note, previewLabel: mark.previewLabel, deviceLabel: mark.deviceLabel,
    edit: sending ? locked : enabled, remove: sending ? locked : enabled, replace: sending ? locked : enabled,
    references: referencesOf(mark),
  })
  const labelOf = (source: TakeIdentity) => {
    if (isOriginal(source)) return "Original · the real files"
    const shown = frameFor(source)?.label
    return shown ? `Take ${source.take} · ${shown}` : `Take ${source.take}`
  }
  const outcomeOf = (group: SendPlan["groups"][number]): MarkupOutcome => {
    const withPrompt = going.filter(mark => group.marks.includes(mark.id)).map(nameOf)
    if (withPrompt.length) return { _tag: "WithPrompt", label: `${listed(withPrompt)} ${withPrompt.length === 1 ? "goes" : "go"} with your prompt when you press New take. Send would make a take from the real files instead.` }
    if (group.outcome._tag === "NewTake") return { _tag: "NewTake", label: "Send makes a new take." }
    const here = marks.filter(mark => group.marks.includes(mark.id)).map(nameOf)
    const pointers = marks.filter(mark => referencesOf(mark).some(name => here.includes(name))).map(nameOf)
    return { _tag: "PointedTo", label: `Pointed to by ${listed(pointers)}; makes no take.` }
  }
  const groups: MarkupGroup[] = plan.groups.map(group => ({
    source: group.source, label: labelOf(group.source),
    marks: marks.filter(mark => group.marks.includes(mark.id)).map(draftMark),
    decision: group.reasons.length ? { _tag: "Blocked", reasons: group.reasons } : { _tag: "Ready" },
    outcome: outcomeOf(group),
  }))
  const open = state.editor ? marks.find(mark => mark.id === state.editor) : undefined
  const send: MarkupSend = state.send ?? { _tag: "Idle", label: plan.label, availability: plan._tag === "Ready" ? enabled : { _tag: "Disabled", reason: plan._tag === "Empty" ? "Add a mark first" : plan.reasons.join(" ") } }
  const markup: MarkupView = {
    _tag: "Ready", revision: state.revision, mode: sending ? { _tag: "Off" } : state.mode, draftOpen: state.draftOpen && groups.length > 0, groups, send,
    editor: open ? { _tag: "Open", id: open.id, name: nameOf(open), note: open.note, edit: sending ? locked : enabled, references: referenceOptions(view, marks, open) } : { _tag: "Closed" },
  }
  const promptMarks: ComposerView["marks"] = going.length
    ? { _tag: "WithPrompt", names: going.map(nameOf), label: `${listed(going.map(nameOf))} ${going.length === 1 ? "goes" : "go"} with this prompt.` }
    : { _tag: "None" }
  return { ...view, canvas, markup, composer: { ...view.composer, marks: promptMarks } }
}

/**
 * Every mark on another take or the original that the note on `editing` can
 * point to, in draft order, with a crop of its place: the page of the frame
 * that shows its take, at the viewport of the device it was placed on. A lost
 * mark has no crop, as core sends it.
 */
function referenceOptions(view: ChromeView, marks: readonly LocalMark[], editing: LocalMark): ReferenceOption[] {
  return marks.filter(mark => mark.source.take !== editing.source.take).map(mark => {
    const shown = (mark.frame ? frames(view).find(frame => frame.key === mark.frame) : undefined) ?? frames(view).find(frame => sameSource(sourceOf(frame), mark.source))
    const device = view.devices.find(item => item.name === mark.deviceLabel)
    return {
      id: mark.id, name: nameOf(mark), note: mark.note,
      label: isOriginal(mark.source) ? `Original · ${mark.previewLabel}` : `Take ${mark.source.take}${shown?.take ? ` · ${shown.label}` : ""}`,
      crop: mark.location._tag === "Lost" || !shown || !device ? null : { src: shown.src, viewport: { width: device.cssWidth, height: device.cssHeight }, rect: mark.rect },
    }
  })
}
