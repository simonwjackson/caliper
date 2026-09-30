import type {
  AgentStatus, CodeDocument, CodeFile, Direction, PartLayer, SkillsStatus, StateRef, TakeRun,
} from "../../types"
import type { CheckResult } from "../../render/check-contract.js"
import type { Device, FrameGeometry } from "../device-frame.js"
import type { Mode } from "../code-editor.js"
import type { Review } from "../../takes/integration.js"
import type { TakeIdentity, MarkLocation } from "../../takes/send-plan.js"

/** Imported mutable wire/geometry values are read-only at the rendering seam too. */
type Snapshot<T> = T extends object ? { readonly [K in keyof T]: Snapshot<T[K]> } : T

/** Local rendering contract, not a wire schema. App wiring validates server payloads. */
export type Availability =
  | { readonly _tag: "Enabled" }
  | { readonly _tag: "Disabled"; readonly reason: string }

export type Notice = { readonly kind: "error" | "warning" | "info"; readonly text: string }
export type Connection =
  | { readonly _tag: "Connecting" }
  | { readonly _tag: "Ready" }
  | { readonly _tag: "Unreachable"; readonly reason: string }
export type Tool = "preview" | "takes" | "knobs" | "code" | "checks" | "calibrate"
export type Selection =
  | { readonly _tag: "None" }
  | { readonly _tag: "All"; readonly part: string }
  | { readonly _tag: "State"; readonly subject: StateRef; readonly preview: StateRef; readonly label: string }
export type Badge = { readonly status: CheckResult["status"] | "Stale"; readonly label: string; readonly detail: string }

export type NavTake = { readonly id: string; readonly label: string; readonly selected: boolean; readonly badge?: Badge }
export type NavState = {
  readonly ref: StateRef; readonly label: string; readonly site: string; readonly selected: boolean
  readonly badge?: Badge; readonly takes: readonly NavTake[]; readonly comparing: boolean
}
export type NavPart = {
  readonly file: string; readonly name: string; readonly note: string; readonly layer?: PartLayer
  readonly layerSite: string; readonly selected: boolean; readonly expanded: boolean; readonly states: readonly NavState[]
}
export type ContextChoice = { readonly key: string; readonly label: string; readonly context: StateRef | null }
export type ScenarioView =
  | { readonly _tag: "None" }
  | {
      readonly _tag: "Selected"; readonly subject: StateRef; readonly editingLabel: string
      readonly choices: readonly ContextChoice[]; readonly chosen: string; readonly note: string
      readonly whole: { readonly ref: StateRef; readonly label: string } | null
      readonly children: readonly { readonly ref: StateRef; readonly label: string; readonly selected: boolean }[]
    }
export type SetupRow = {
  readonly label: string; readonly status: "Derived" | "Overridden" | "Failed"
  readonly values: readonly string[]; readonly provenance: string; readonly problems: readonly string[]
}
export type NavigationView = {
  readonly project: string; readonly filter: string; readonly countLabel: string; readonly emptyMessage: string
  readonly parts: readonly NavPart[]; readonly scenario: ScenarioView
  readonly unavailable: readonly { readonly subject: StateRef; readonly label: string; readonly takes: readonly NavTake[] }[]
  readonly setup: readonly SetupRow[]; readonly setupProblems: readonly string[]
}

export type FrameProblem = { readonly kind: "error" | "warning"; readonly title: string; readonly detail: string }
export type FrameVerdict =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Rendered" }
  | { readonly _tag: "Empty" }
  | { readonly _tag: "Failed" }
/** Gesture coordinates are device CSS px from the iframe viewport, before physical scaling. */
export type MarkPoint = { readonly x: number; readonly y: number }
export type MarkRect = MarkPoint & { readonly width: number; readonly height: number }
export type MarkPin = {
  /** Opaque draft id. Take number plus letter is a display name, never a mutation identity. */
  readonly id: string; readonly letter: string; readonly kind: "Point" | "Region"
  /**
   * Resolved rect, or the last known rect for a lost/unresolved mark, in device viewport CSS px.
   * A `Point` rect has zero width and height and sits at the clicked point, so its
   * centre is the pin's tip. A `Region` rect is the marked box.
   */
  readonly rect: MarkRect; readonly location: MarkLocation
}
export type DraftMarkView = MarkPin & {
  readonly name: string; readonly note: string; readonly previewLabel: string; readonly deviceLabel: string
  readonly edit: Availability; readonly remove: Availability; readonly replace: Availability
  /**
   * Phase 6. Names of marks on other takes or the original that this note points to,
   * in the order written ("use 2A here" gives ["2A"]). The note text holds them; the
   * UI may set them apart but must not rewrite the note.
   */
  readonly references: readonly string[]
}
/**
 * Phase 6 (plan decisions 7 and 8, planner choice 14). What Send, or New take,
 * does with one group. `label` is a full sentence for the draft row, for example
 * "Send makes take 4's next take." or "Pointed to by 3A; makes no take."
 * `WithPrompt`: marks on the original that go with the typed prompt when you press
 * New take, and then leave the draft.
 */
export type MarkupOutcome = { readonly _tag: "NewTake" | "PointedTo" | "WithPrompt"; readonly label: string }
export type MarkupGroup = {
  /** Phase 6: the original (the real files) is `{ take: "0", created: 0 }`; its marks are named "0A". */
  readonly source: TakeIdentity; readonly label: string; readonly marks: readonly DraftMarkView[]
  readonly decision: { readonly _tag: "Ready" } | { readonly _tag: "Blocked"; readonly reasons: readonly string[] }
  readonly outcome: MarkupOutcome
}
/**
 * Phase 6 type-ahead. A mark the open note can point to: on another take or on the
 * original. The UI inserts `name` into the note through `onMarkNote`. `crop` lets the
 * UI draw the place: the frame `src` at `viewport` CSS px, clipped to `rect`
 * (document-origin CSS px of that frame). Null when the mark is lost.
 */
export type ReferenceOption = {
  readonly id: string; readonly name: string; readonly note: string; readonly label: string
  readonly crop: { readonly src: string; readonly viewport: { readonly width: number; readonly height: number }; readonly rect: MarkRect } | null
}
export type MarkMode = { readonly _tag: "Off" } | { readonly _tag: "Marking" } | { readonly _tag: "Replacing"; readonly id: string }
export type MarkupSend =
  | { readonly _tag: "Idle"; readonly label: string; readonly availability: Availability }
  | { readonly _tag: "Sending"; readonly label: string }
  | { readonly _tag: "Failed"; readonly label: string; readonly reason: string; readonly availability: Availability }
export type MarkupView =
  | { readonly _tag: "Unavailable"; readonly reason: string }
  | {
      readonly _tag: "Ready"; readonly revision: number; readonly mode: MarkMode; readonly draftOpen: boolean
      readonly groups: readonly MarkupGroup[]; readonly send: MarkupSend
      readonly editor: { readonly _tag: "Closed" } | {
        readonly _tag: "Open"; readonly id: string; readonly name: string; readonly note: string; readonly edit: Availability
        /** Phase 6: every mark this note can point to, in draft order. The UI filters it as you type. */
        readonly references: readonly ReferenceOption[]
      }
    }

export type FrameView = {
  /** Include take creation identity, not only its reusable numeric id. Preserve DOM while key/src stay unchanged. */
  readonly key: string; readonly label: string; readonly title: string; readonly src: string
  readonly subject: StateRef; readonly preview: StateRef; readonly take: string | null
  readonly selected: boolean; readonly run?: TakeRun; readonly verdict: FrameVerdict
  readonly problems: readonly FrameProblem[]
  /** Phase 6: the original frame is markable too. Alternate frames are not. Running experiments can receive marks. */
  readonly markable: Availability; readonly marks: readonly MarkPin[]
}
/**
 * Phase 5 (plan decision 12, planner choice 15 answered C). A take made before a
 * later accept that touched its part or one of its files. Accepting it can undo
 * that accept. It warns; it never blocks. `label` reads "made before take 8 was
 * accepted"; `detail` says why (the part, or which files).
 */
export type AcceptFlag =
  | { readonly _tag: "Current" }
  | { readonly _tag: "Before"; readonly take: string; readonly label: string; readonly detail: string }
/** One take a chain has had, oldest first. A present step selects its take with `onTake`. */
export type ChainStepView =
  | { readonly _tag: "Present"; readonly take: string; readonly label: string; readonly selected: boolean }
  | { readonly _tag: "Discarded"; readonly take: string; readonly label: string }
/**
 * Phase 5 (plan decisions 11 and 13). One chain of takes on the Takes canvas:
 * the shown take next to its nearest ancestor that still exists. `shown` and
 * `parent` are keys of frames in the same canvas. `parent` is null for a chain
 * of one, or when every ancestor is discarded. The shown take is the selected
 * take when it is in this chain, otherwise the chain's newest take. The UI
 * decides, per device and from the canvas size, whether the pair fits (decision
 * 35). When it does not, the UI draws only the frame that `solo` names, and one
 * control calls `onChainSolo` to swap (planner choice 19, answered B: core owns
 * the swap, so it survives a reload).
 */
export type ChainView = {
  /** Opaque. Stable while the chain exists, including after its first take is discarded. */
  readonly id: string
  readonly shown: string; readonly parent: string | null
  /** The shown take's number, and its heading, for example "7 ← from 3 (5 discarded)". */
  readonly take: string; readonly label: string
  /** None for a chain of one step. Folded and Open carry "3 in chain". */
  readonly history:
    | { readonly _tag: "None" }
    | { readonly _tag: "Folded"; readonly label: string }
    | { readonly _tag: "Open"; readonly label: string; readonly steps: readonly ChainStepView[] }
  /** The shown take's flag. */
  readonly flag: AcceptFlag
  /** Which frame a pair that does not fit shows. Always "Shown" when `parent` is null. */
  readonly solo: "Shown" | "Parent"
}
export type CanvasView =
  | { readonly _tag: "Empty"; readonly message: string }
  | {
      readonly _tag: "Frames"; readonly mode: "One" | "All" | "Takes"
      readonly title: string; readonly frames: readonly FrameView[]
      /**
       * Takes mode only; empty otherwise. Every take frame in `frames` belongs to
       * exactly one chain, as its `shown` or its `parent`. Frames in no chain are
       * the real files or a preview state.
       */
      readonly chains: readonly ChainView[]
    }
export type PlanView =
  | { readonly _tag: "None" }
  | { readonly _tag: "Planning"; readonly prompt: string; readonly count: number; readonly message: string }
  | {
      readonly _tag: "Review"; readonly prompt: string; readonly note: string
      /** Stable ids survive editing/removal. Titles are not identities. */
      readonly directions: readonly { readonly id: string; readonly direction: Direction }[]
      readonly start: Availability; readonly startLabel: string
    }
export type AttachmentView = { readonly id: string; readonly name: string; readonly url: string; readonly remove: Availability }
export type ComposerView = {
  readonly prompt: string; readonly placeholder: string; readonly edit: Availability; readonly attach: Availability
  readonly attachments: readonly AttachmentView[]; readonly count: 1 | 2 | 3 | 4
  readonly start: Availability; readonly startLabel: string
  readonly follow: { readonly take: string; readonly label: string; readonly availability: Availability } | null
  /**
   * Phase 6 (planner choice 14). Marks on the original that go with this prompt when
   * you press New take, for example "0A and 0B go with this prompt." They then leave
   * the draft. Marks a note points to stay for Send.
   */
  readonly marks: { readonly _tag: "None" } | { readonly _tag: "WithPrompt"; readonly names: readonly string[]; readonly label: string }
  readonly notices: readonly Notice[]
  readonly agent: { readonly _tag: "Connecting" } | AgentStatus; readonly skills: SkillsStatus
}
export type LogEntry =
  | { readonly _tag: "User"; readonly text: string; readonly images: readonly { readonly name: string; readonly url: string }[] }
  | { readonly _tag: "Assistant"; readonly text: string }
  | { readonly _tag: "Edit"; readonly file: string }
  | { readonly _tag: "Tool"; readonly name: string; readonly subject: string; readonly outcome: "Running" | "Done" | "Failed"; readonly detail: string }
export type TakeSummary = {
  readonly id: string; readonly name: string; readonly subjectLabel: string; readonly deviceLabel: string
  readonly createdLabel: string; readonly run: TakeRun; readonly files: readonly string[]; readonly nameIssue: string
  readonly direction: Direction | null; readonly unavailableReason: string
  readonly accept: Availability; readonly discard: Availability; readonly stop: Availability; readonly prepareAlternate: Availability
  readonly kind: "Experiment" | "Alternate"
  /** Phase 5. The chain heading for this take, "" for a take with no ancestors. */
  readonly lineage: string
  readonly flag: AcceptFlag
}
export type IntegrationView =
  | { readonly _tag: "None" }
  | { readonly _tag: "Preparing"; readonly sourceTake: string; readonly message: string }
  | { readonly _tag: "Unloaded"; readonly sourceTake: string; readonly load: Availability; readonly notices: readonly Notice[] }
  | {
      readonly _tag: "Review"; readonly sourceTake: string; readonly review: Snapshot<Review>
      readonly refresh: Availability; readonly check: Availability; readonly apply: Availability
      readonly behaviorReviewed: boolean; readonly notices: readonly Notice[]
    }
export type TakeRecordView =
  | { readonly _tag: "Closed" }
  | {
      readonly _tag: "Open"; readonly take: TakeSummary; readonly log: readonly LogEntry[]
      readonly emptyLogMessage: string; readonly integration: IntegrationView
    }

export type SaveState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Edited" }
  | { readonly _tag: "Saving" }
  | { readonly _tag: "Saved"; readonly label: string }
  | { readonly _tag: "Failed"; readonly reason: string }
export type CodeFileView = CodeFile & { readonly label: string; readonly added?: number; readonly removed?: number }
export type CodeView =
  | { readonly _tag: "Closed" }
  | { readonly _tag: "Loading"; readonly message: string }
  | { readonly _tag: "Failed"; readonly reason: string; readonly retry: Availability }
  | { readonly _tag: "Empty"; readonly message: string }
  | {
      readonly _tag: "Ready"; readonly files: readonly CodeFileView[]; readonly tabs: readonly string[]
      readonly filter: string; readonly selectedFile: string; readonly document: CodeDocument
      /** Changes from disk must not be reported back as human edits. */
      readonly documentKey: string; readonly mode: Snapshot<Mode>; readonly save: SaveState; readonly notice: string
      readonly changes: number; readonly take: string | null; readonly stop: Availability
      readonly lenses: readonly { readonly export: string; readonly label: string; readonly current: boolean }[]
    }

export type KnobWrite =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Saving" }
  | { readonly _tag: "Saved" }
  | { readonly _tag: "Conflict"; readonly reason: string }
  | { readonly _tag: "Failed"; readonly reason: string }
export type KnobControl =
  | { readonly _tag: "Number"; readonly number: number; readonly unit: string; readonly step: number; readonly min?: number; readonly max?: number }
  | { readonly _tag: "Color"; readonly hex: string | null }
  | { readonly _tag: "Choice"; readonly options: readonly string[] }
  | { readonly _tag: "Token"; readonly chosen: string; readonly options: readonly { readonly name: string; readonly value: string }[]; readonly color: boolean }
export type KnobView = {
  readonly id: string; readonly name: string; readonly label: string; readonly value: string
  readonly origin: "Property" | "Plain" | "Threshold"; readonly where: string
  readonly source: { readonly file: string; readonly line: number }; readonly note: string; readonly problems: readonly string[]
  readonly control: KnobControl; readonly write: KnobWrite; readonly edit: Availability
}
export type SkippedKnob = { readonly name: string; readonly where: string; readonly reason: string }
export type LiteralDraft =
  | { readonly _tag: "Closed" }
  | {
      readonly _tag: "Editing" | "Saving" | "Failed"; readonly name: string; readonly home: string
      readonly preview: string; readonly problem: string; readonly create: Availability
    }
export type LiteralView = {
  readonly id: string; readonly property: string; readonly value: string; readonly selector: string
  readonly source: { readonly file: string; readonly line: number }
  readonly homes: readonly { readonly id: string; readonly label: string }[]; readonly draft: LiteralDraft
}
export type LiteralsView =
  | { readonly _tag: "Closed" }
  | { readonly _tag: "Finding" }
  | { readonly _tag: "Failed"; readonly reason: string }
  | { readonly _tag: "Ready"; readonly literals: readonly LiteralView[]; readonly refused: readonly SkippedKnob[]; readonly notice: string }
export type KnobsView =
  | { readonly _tag: "Closed" }
  | { readonly _tag: "Idle"; readonly message: string }
  | { readonly _tag: "Finding"; readonly target: string }
  | {
      readonly _tag: "Ready"; readonly target: string; readonly knobs: readonly KnobView[]
      readonly skipped: readonly SkippedKnob[]; readonly problems: readonly string[]; readonly literals: LiteralsView
    }

export type EvidenceImage = {
  readonly key: string; readonly kind: "first" | "repeat" | "baseline" | "authored"
  readonly url: string; readonly label: string; readonly caption: string
}
export type FindingView = { readonly id: string; readonly label: string; readonly status: CheckResult["status"]; readonly detail: string; readonly image?: EvidenceImage }
export type CheckRow = {
  readonly index: number; readonly part: string; readonly state: string; readonly device: string; readonly take: string | null
  readonly badge: Badge; readonly findings: readonly FindingView[]; readonly authored: readonly FindingView[]
  readonly provenance: string; readonly authoredSummary: string; readonly images: readonly EvidenceImage[]
  readonly approval: Availability; readonly reviewed: boolean; readonly approved: boolean; readonly approvalNote: string
}
export type ChecksRun =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Running"; readonly id: string; readonly progress: string; readonly stop: Availability }
  | { readonly _tag: "Failed" | "Cancelled"; readonly reason: string }
  | {
      readonly _tag: "Ready"; readonly id: string; readonly badge: Badge; readonly stale: boolean
      readonly summary: string; readonly coverage: string; readonly runDetail: string
      readonly reportUrl: string; readonly rows: readonly CheckRow[]
    }
export type ChecksView =
  | { readonly _tag: "Closed" }
  | {
      readonly _tag: "Open"; readonly targetLabel: string; readonly runSelected: Availability; readonly runAll: Availability
      readonly run: ChecksRun; readonly notices: readonly Notice[]
    }
export type CalibrationView =
  | { readonly _tag: "Closed" }
  | { readonly _tag: "Open"; readonly pxPerMm: number; readonly calibrated: boolean }

/** One immutable snapshot. Empty/error cases carry their own data, not unrelated nullable payloads. */
export type ChromeView = {
  readonly connection: Connection; readonly selection: Selection; readonly navigation: NavigationView
  readonly devices: readonly Snapshot<Device>[]; readonly device: Snapshot<Device>; readonly pxPerMm: number; readonly calibrated: boolean
  readonly tools: { readonly active: Tool; readonly navOpen: boolean; readonly codeOpen: boolean; readonly side: "closed" | "knobs" | "record"; readonly codeShare: number }
  readonly canvas: CanvasView; readonly plan: PlanView; readonly composer: ComposerView; readonly markup: MarkupView
  readonly focusedTake: TakeSummary | null; readonly record: TakeRecordView
  readonly code: CodeView; readonly knobs: KnobsView; readonly checks: ChecksView; readonly calibration: CalibrationView
}

/**
 * Stable callbacks owned by app wiring. Calls return immediately; errors/progress arrive in ChromeView.
 * Core rechecks availability, identity and server revision. Disabled controls are not a security fence.
 * No fetch, storage, CSSOM discovery or server imports below this seam.
 */
export type ChromeActions = {
  readonly onTool: (tool: Tool) => void
  readonly onNavOpen: (open: boolean) => void
  readonly onFilter: (value: string) => void
  readonly onPart: (file: string) => void
  readonly onPartExpanded: (file: string, open: boolean) => void
  readonly onState: (ref: StateRef) => void
  readonly onCompare: (ref: StateRef) => void
  readonly onTake: (take: string) => void
  readonly onContext: (key: string) => void
  readonly onSubject: (ref: StateRef) => void
  readonly onWholeScenario: () => void
  readonly onDevice: (id: string) => void
  readonly onPrompt: (text: string) => void
  readonly onCount: (count: 1 | 2 | 3 | 4) => void
  readonly onAttach: (files: readonly File[]) => void
  readonly onRemoveAttachment: (id: string) => void
  readonly onStart: () => void
  readonly onFollow: (take: string) => void
  readonly onMarkMode: (on: boolean) => void
  /** UI converts physical geometry to viewport CSS px. Core resolves anchors and document scroll offsets. */
  readonly onMarkPoint: (frameKey: string, point: MarkPoint) => void
  readonly onMarkRegion: (frameKey: string, rect: MarkRect) => void
  /** Open/close the note editor without re-placing a mark. null closes it. */
  readonly onMarkEdit: (id: string | null) => void
  readonly onMarkNote: (id: string, note: string) => void
  readonly onMarkRemove: (id: string) => void
  /** Next placement moves this id, preserving its letter. Core checks take, preview and device identity. */
  readonly onMarkReplace: (id: string) => void
  readonly onDraftOpen: (open: boolean) => void
  /** A stale revision, lost/unresolved mark or running parent blocks the entire pass. No partial Send. */
  readonly onSend: (revision: number) => void
  readonly onPlanBack: () => void
  readonly onDirection: (id: string, field: "title" | "brief", text: string) => void
  readonly onRemoveDirection: (id: string) => void
  /** Fold or unfold a chain's history. Selecting a step uses `onTake`. */
  readonly onChainHistory: (chain: string, open: boolean) => void
  /** Which frame a chain shows when its pair does not fit. Core ignores "Parent" for a chain with no parent. */
  readonly onChainSolo: (chain: string, solo: "Shown" | "Parent") => void
  /**
   * Accept/follow flush the editor first. Core owns confirmation and exact-take revalidation.
   * Phase 5: accept removes every take in the accepted take's chain; discard removes one take.
   * Core's confirmation names the other takes it removes (planner choice 20, answered B).
   */
  readonly onAccept: (take: string) => void
  readonly onDiscard: (take: string) => void
  readonly onStop: (take: string) => void
  readonly onPrepareAlternate: (take: string) => void
  readonly onRecordClose: () => void
  readonly onReview: (take: string) => void
  readonly onIntegrationCheck: (take: string, revision: string) => void
  readonly onBehaviorReviewed: (take: string, revision: string, reviewed: boolean) => void
  readonly onApplyAlternate: (take: string, revision: string) => void
  readonly onOpenFile: (file: string) => void
  readonly onFileFilter: (value: string) => void
  readonly onCodeRetry: () => void
  readonly onCodeEdit: (content: string) => void
  readonly onCodeSave: () => void
  readonly onPreviousChange: () => void
  readonly onNextChange: () => void
  /** Live resize uses commit=false; release/reset/keyboard uses commit=true. UI owns axis/coordinates. */
  readonly onCodeShare: (share: number, commit: boolean) => void
  /** Number/color dragging calls input, then commit once. Cancel restores without a file write. */
  readonly onKnobInput: (id: string, value: string) => void
  readonly onKnobCommit: (id: string, value: string) => void
  readonly onKnobCancel: (id: string) => void
  readonly onLiteralsOpen: (open: boolean) => void
  readonly onLiteralDraft: (id: string, open: boolean) => void
  readonly onLiteralName: (id: string, name: string) => void
  readonly onLiteralHome: (id: string, home: string) => void
  readonly onPromote: (id: string) => void
  readonly onChecksClose: () => void
  readonly onCheckRun: (scope: "selected" | "all") => void
  readonly onCheckStop: (run: string) => void
  readonly onImageLoaded: (run: string, index: number, key: string) => void
  readonly onImageFailed: (run: string, index: number, key: string) => void
  readonly onImageReviewed: (run: string, index: number, reviewed: boolean) => void
  readonly onApproveImage: (run: string, index: number) => void
  readonly onPxPerMm: (value: number) => void
  readonly onResetCalibration: () => void
  readonly onCalibrationClose: () => void
  /** null unregisters. Preserve stable refs and keys across stream updates to avoid iframe/editor remounts. */
  readonly onFrameMount: (key: string, frame: HTMLIFrameElement | null) => void
  readonly onFrameGeometry: (key: string, geometry: FrameGeometry) => void
  readonly onEditorMount: (host: HTMLDivElement | null) => void
  readonly onReviewDiffMount: (take: string, revision: string, file: string, host: HTMLDivElement | null) => void
}
export type ChromeProps = { readonly view: ChromeView; readonly actions: ChromeActions }
