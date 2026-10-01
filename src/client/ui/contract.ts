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
/**
 * Decision 45. While an open workspace is selected, every state has a pin: a
 * pinned state is a row on the board. `None` when no open workspace is selected.
 */
export type PinView =
  | { readonly _tag: "None" }
  | { readonly _tag: "Pin"; readonly pinned: boolean; readonly availability: Availability }
export type NavState = {
  readonly ref: StateRef; readonly label: string; readonly site: string; readonly selected: boolean
  readonly badge?: Badge; readonly takes: readonly NavTake[]; readonly comparing: boolean
  readonly pin: PinView
}
export type NavPart = {
  readonly file: string; readonly name: string; readonly note: string; readonly layer?: PartLayer
  readonly layerSite: string; readonly selected: boolean; readonly expanded: boolean; readonly states: readonly NavState[]
  /** How many of its states the selected workspace's board shows. */
  readonly pinned: number
}
/** One workspace in the parts panel (decision 45). `meta` reads "Open · 3 ideas"; `problem` says why a file cannot be read. */
export type WorkspaceItem = { readonly id: string; readonly name: string; readonly meta: string; readonly selected: boolean; readonly problem: string }
export type WorkspacesView = { readonly items: readonly WorkspaceItem[]; readonly create: Availability }
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
/** A project the Caliper app can show (decision 37). `problem` says why it cannot open; empty when it can. */
export type ProjectChoice = { readonly id: string; readonly name: string; readonly current: boolean; readonly problem: string }
/** The project switcher. Hidden while no other project is running. */
export type ProjectsView =
  | { readonly _tag: "Hidden" }
  | { readonly _tag: "Choices"; readonly choices: readonly ProjectChoice[] }
export type NavigationView = {
  readonly project: string; readonly projects: ProjectsView; readonly workspaces: WorkspacesView
  readonly filter: string; readonly countLabel: string; readonly emptyMessage: string
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
/**
 * Several takes from one prompt (decision 16). The planner runs, then every
 * direction starts as a take at once. There is no review step: a direction you
 * do not want is a take you discard. `message` is the one status line.
 */
export type PlanView =
  | { readonly _tag: "None" }
  | { readonly _tag: "Planning"; readonly count: number; readonly message: string }
/**
 * The agent's model, chosen in the app for every project (decision 43). `Idle` until
 * the chooser first unfolds. `favorites` are pi's scoped models that the endpoint
 * serves; `models` are the rest. `choosing` is a model being saved.
 */
export type ModelsView =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Ready"; readonly current: string; readonly favorites: readonly string[]; readonly models: readonly string[]; readonly problem: string; readonly choosing: string | null }
  | { readonly _tag: "Failed"; readonly reason: string }
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
  readonly models: ModelsView
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

/**
 * The board of a workspace (decision 45): one row for each pinned state, one
 * column for Today (the real files) and one for each idea. `planBoard` decides
 * which columns and rows are on screen; every cell stays one picker press away.
 */
export type BoardRowView = {
  readonly key: string; readonly ref: StateRef; readonly part: string; readonly state: string; readonly site: string
  /** The state no longer exists. Its cells say so; you can unpin it. */
  readonly missing: boolean
  /** How many named checks the row declares. With none, its cells have no check line. */
  readonly checks: number
  /** A row the workspace's row agent writes (slice 2), or null for a pinned state. */
  readonly scratch: ScratchRowView | null
  /** The row's record is open in the side panel. */
  readonly open: boolean
}
/**
 * A scratch row: one file in the workspace folder that a row agent writes.
 * Until the agent writes the file, the row waits; `name` is then the start of what you asked.
 */
export type ScratchRowView = { readonly id: string; readonly run: TakeRun; readonly written: boolean; readonly focused: boolean }
/** How the row's checks went in one cell. */
export type CellChecksView =
  /** The row declares no checks. */
  | { readonly _tag: "None" }
  /** No result since the app started. */
  | { readonly _tag: "NotRun" }
  | { readonly _tag: "Waiting" }
  | { readonly _tag: "Running" }
  /** `stale`: the row, the idea or the project changed after this run. */
  | { readonly _tag: "Done"; readonly passed: number; readonly total: number; readonly stale: boolean }
  /** The run could not finish, for example because the page failed or the browser was lost. */
  | { readonly _tag: "Unknown"; readonly reason: string }
/** One named check of a row, and how it went in each column. */
export type RowCheckView = {
  readonly name: string; readonly line: number
  readonly results: readonly { readonly column: string; readonly status: "Passed" | "Failed" | "Inconclusive" | "NotRun" | "Waiting" | "Running"; readonly detail: string; readonly image: string | null }[]
}
/**
 * A row's record, in the side panel where the questions sit: what you
 * asked, the file, each check in each column, and the row agent's log. A
 * pinned state's record has its checks only.
 */
export type RowRecordView =
  | { readonly _tag: "Closed" }
  | {
      readonly _tag: "Open"; readonly row: string; readonly title: string; readonly file: string
      /** What you asked the row agent; empty for a pinned state. */
      readonly brief: string
      readonly scratch: { readonly id: string; readonly run: TakeRun; readonly stop: Availability; readonly remove: Availability } | null
      readonly columns: readonly { readonly key: string; readonly label: string }[]
      /** The column whose results unfold, and whose image shows. */
      readonly column: string
      readonly checks: readonly RowCheckView[]
      readonly checkAgain: Availability
      readonly log: readonly LogEntry[]
    }
export type BoardColumnView =
  | { readonly _tag: "Today"; readonly key: string }
  /** A place the planner is filling. */
  | { readonly _tag: "Planned"; readonly key: string }
  | {
      readonly _tag: "Idea"; readonly key: string; readonly take: string; readonly name: string; readonly brief: string
      readonly strange: boolean; readonly run: TakeRun; readonly files: number; readonly focused: boolean
    }
/**
 * One row in one column. `frame` is null while its column is planned or its
 * idea's agent works. `same`: the frame shows exactly what Today shows.
 */
export type BoardCellView = { readonly row: string; readonly column: string; readonly frame: FrameView | null; readonly same: boolean; readonly checks: CellChecksView }
export type QuestionView =
  | { readonly _tag: "Open"; readonly id: string; readonly text: string; readonly by: string }
  | { readonly _tag: "Answered"; readonly id: string; readonly text: string; readonly by: string; readonly answer: string; readonly reason: string }
/**
 * The bar under the board. Ask: you write the question, and the main button
 * plans the ideas. More: the prompt describes another idea. Idea: the prompt
 * goes to the focused idea. NewRow: the prompt says what a new row must show
 * and check. Row: the prompt goes to the focused row's agent. Closed: nothing
 * more can start.
 */
export type WorkspaceBarView = {
  readonly mode: "Ask" | "More" | "Idea" | "NewRow" | "Row" | "Closed"
  readonly prompt: string; readonly placeholder: string; readonly edit: Availability
  readonly count: 1 | 2 | 3 | 4; readonly go: { readonly label: string; readonly availability: Availability }
  readonly idea: { readonly take: string; readonly label: string; readonly discard: Availability; readonly stop: Availability } | null
  readonly row: { readonly id: string; readonly label: string; readonly remove: Availability; readonly stop: Availability } | null
  readonly notices: readonly Notice[]
}
export type BoardView =
  | { readonly _tag: "None" }
  | { readonly _tag: "Damaged"; readonly id: string; readonly reason: string }
  | {
      readonly _tag: "Open"; readonly id: string; readonly title: string
      readonly status: "New" | "Open" | "Closed"; readonly statusLabel: string
      /** The question in full; empty until you write it. `asked` says when, for the Questions panel. */
      readonly question: string; readonly asked: string
      readonly rows: readonly BoardRowView[]; readonly columns: readonly BoardColumnView[]; readonly cells: readonly BoardCellView[]
      readonly questions: readonly QuestionView[]; readonly ask: Availability; readonly answer: Availability
      /** What Discard deletes and keeps, for its confirmation. */
      readonly discard: { readonly availability: Availability; readonly ideas: number; readonly files: number; readonly answered: number; readonly open: number }
      readonly bar: WorkspaceBarView
      /** New row: the bar then asks what a new scratch row must show and check. */
      readonly newRow: Availability
      /** A row's record holds the side panel in place of the questions. */
      readonly record: RowRecordView
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
  /** The selected workspace's board. While one is open it replaces the canvas, and the side slot of a take's record holds its questions. */
  readonly workspace: BoardView
}

/**
 * Stable callbacks owned by app wiring. Calls return immediately; errors/progress arrive in ChromeView.
 * Core rechecks availability, identity and server revision. Disabled controls are not a security fence.
 * No fetch, storage, CSSOM discovery or server imports below this seam.
 */
export type ChromeActions = {
  /** Open another project in this tab. Other tabs keep their own project. */
  readonly onProject: (id: string) => void
  /** A press opens a closed pane, brings a covered one to the front, or closes the one in front. */
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
  /** Load the models the agent can use. The UI asks when the model chooser unfolds. */
  readonly onModels: () => void
  /** Use this model for every take and plan that starts next, in every project. */
  readonly onModel: (model: string) => void
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
  /** Stops a plan that is still planning. Takes that already started stay. */
  readonly onPlanCancel: () => void
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
  /** The pane's own Close. Closing brings back the most recent tool that is still open. */
  readonly onCodeClose: () => void
  readonly onKnobsClose: () => void
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
  /** Decision 45. Show a workspace's board; null goes back to the parts. */
  readonly onWorkspace: (id: string | null) => void
  readonly onWorkspaceNew: () => void
  /** Make a state a row of the selected workspace's board, or take it off. */
  readonly onPin: (ref: StateRef, pinned: boolean) => void
  /** Focus an idea's column, so the bar talks to it; null focuses none. */
  readonly onIdea: (take: string | null) => void
  /** Open or close the questions, in the side slot. */
  readonly onQuestions: (open: boolean) => void
  readonly onAsk: (text: string) => void
  readonly onAnswer: (question: string, answer: string, reason: string) => void
  /** Ask: save the question and plan the ideas, or start one. More: start an idea from the prompt. */
  readonly onWorkspaceStart: () => void
  readonly onIdeaFollow: (take: string) => void
  readonly onIdeaDiscard: (take: string) => void
  /** Delete every idea; the question and the answers stay, and the workspace closes. */
  readonly onWorkspaceDiscard: (id: string) => void
  /** Workspaces slice 2. Put the bar in New row, where the prompt says what a new row must show and check, or take it out. */
  readonly onRowNew: (open: boolean) => void
  /** Open a row's record in the side panel, with one column's results unfolded; null closes it. A scratch row is also focused, so the bar talks to its agent. */
  readonly onRowRecord: (row: string | null, column?: string) => void
  /** New row: start a row agent with the prompt. Row: send the prompt to the focused row's agent. */
  readonly onRowWrite: () => void
  readonly onRowStop: (id: string) => void
  /** Delete a scratch row: its agent stops, and its file and its place on the board go. */
  readonly onRowDelete: (id: string) => void
  /** Run one row's checks again, in every column whose agent is idle. */
  readonly onRowCheck: (row: string) => void
}
export type ChromeProps = { readonly view: ChromeView; readonly actions: ChromeActions }
