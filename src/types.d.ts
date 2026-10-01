/**
 * The shapes Caliper derives from a project and sends to its UI.
 *
 * Every derived value carries where it came from, so the UI can show the
 * reason when a part renders wrong. Paths are relative to the Vite root and
 * use forward slashes.
 */

/** A place in the project's source: a root-relative file and a 1-based line. */
export type SourceSite = {
  readonly file: string
  readonly line: number
}

/**
 * The result of one derivation.
 *
 * - `Derived`: Caliper found the value in the project's source at `source`.
 * - `Overridden`: the project set the value with a `caliper()` option.
 * - `Failed`: Caliper could not find the value. `reason` says why, and `hint`
 *   names the option that fixes it.
 */
export type Derivation<A> =
  | {
      readonly _tag: "Derived"
      readonly value: A
      readonly source: SourceSite
      /** How Caliper found the value, in words, for example "package.json exports[\".\"]". */
      readonly via: string
    }
  | {
      readonly _tag: "Overridden"
      readonly value: A
      readonly option: "entry" | "wrap" | "css"
    }
  | {
      readonly _tag: "Failed"
      readonly reason: string
      readonly hint: string
    }

/** The module the app starts from. */
export type Entry = {
  readonly file: string
}

/** One global stylesheet Caliper injects before the selected part loads. */
export type GlobalStylesheet = {
  readonly file: string
  /** Absent for an explicit css option, whose source is the Vite config. */
  readonly importedAt?: SourceSite
}

/** An import Caliper could not resolve while it walked the entry's imports. */
export type UnresolvedImport = {
  readonly specifier: string
  readonly at: SourceSite
}

export type GlobalCss = {
  /** Direct entry imports in source order, or the explicit css option's order. */
  readonly stylesheets: readonly GlobalStylesheet[]
  readonly unresolved: readonly UnresolvedImport[]
}

/** One DOM element of the app's outer shell, outermost first. */
export type WrapperElement = {
  readonly tag: string
  readonly className: string
}

export type Wrapper = {
  readonly elements: readonly WrapperElement[]
  /** The `render(...)` call that mounts the app, when Caliper derived the wrapper. */
  readonly renderedAt?: SourceSite
}

/** Declared composition level, ordered from the whole page to a leaf. */
export type PartLayer = "page" | "template" | "organism" | "molecule" | "atom"

/** A product-owned state, identified independently of where it is previewed. */
export type StateRef = Readonly<import("typebox").Static<typeof import("./scenario-contract.js").StateRefSchema>>

export type Part = {
  /** Root-relative path, for example "src/ui/atoms/PicoButton.atom.part.tsx". */
  readonly file: string
  /** The part's `export const name`, or a name made from the file name. */
  readonly name: string
  /** The part's `export const note`, when it has one. */
  readonly note?: string
  /** Literal `export const layer`, then the `.<layer>.part.tsx` suffix. Absent when unclassified. */
  readonly layer?: PartLayer
  /** The explicit layer export's location. Absent when the filename declares the layer. */
  readonly layerSource?: SourceSite
  /** The part's states. The default export is always first. */
  readonly states: readonly PartState[]
  /** Declared child states in each scenario. This metadata never changes how a state renders. */
  readonly composition?: Readonly<Record<string, readonly StateRef[]>>
  /** Invalid declarations are reported instead of supplying inferred relationships. */
  readonly compositionProblems?: readonly string[]
  /** Static per-state intent. It changes check classification, not product rendering. */
  readonly expectations?: import("./expectation-contract.js").Expectations
  readonly expectationProblems?: readonly string[]
  /** Named browser checks, read from literal callback declarations without executing them. */
  readonly authoredChecks?: Record<string, readonly import("./authored/contract.js").CheckDeclaration[]>
  /** Invalid declarations supply no runnable checks. */
  readonly authoredCheckProblems?: readonly string[]
}

/**
 * One state of a part: one exported component that renders with no props.
 * The default export is the state `default`. Each exported component whose
 * name starts with an upper-case letter is another state.
 */
export type PartState = {
  /** The export's name, for example "default" or "CatalogError". */
  readonly export: string
  /** The name the chrome shows, for example "Catalog error". */
  readonly label: string
  /** Where a named state is exported. The default state has no line. */
  readonly line?: number
}

export type Project = {
  /** The package name, or the root folder's name. */
  readonly name: string
  readonly parts: readonly Part[]
  readonly entry: Derivation<Entry>
  readonly css: Derivation<GlobalCss>
  readonly wrapper: Derivation<Wrapper>
  /** The devices to show and check, from the `devices` option. The first is the default device. */
  readonly devices: readonly import("./client/device-frame.js").Device[]
}

/** What a device frame loads, in the order it loads it. */
export type FrameConfig = {
  /** URL of the part module. */
  readonly part: string
  readonly partFile: string
  /** The export to render, for example "default" or "CatalogError". */
  readonly state: string
  /** The take the frame overlays on the real files. Absent for the real part. */
  readonly take?: string
  /** URLs of the global stylesheets. */
  readonly css: readonly string[]
  /** Problems the server found while it prepared the frame. The frame shows them as warnings. */
  readonly warnings: readonly string[]
  readonly expectations?: import("./expectation-contract.js").StateExpectations
  readonly expectationProblems?: readonly string[]
  readonly wrapper: readonly WrapperElement[]
  /** URL of the module that re-exports the project's own React. */
  readonly react: string
}

/** Resolves an import the way the project's Vite does. Returns an absolute file path, or null. */
export type Resolve = (specifier: string, importer: string) => Promise<string | null>

/** How hard the model thinks before it answers. `xhigh` and `max` work only on some models. */
export type ReasoningLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"

/**
 * The API the agent speaks. `chat-completions` and `responses` are the OpenAI
 * APIs, which most local servers and proxies also speak. `anthropic` is the
 * Anthropic Messages API and `google` is the Gemini API.
 */
export type AgentApi = "chat-completions" | "responses" | "anthropic" | "google"

/**
 * The agent that makes takes. It runs in the Caliper app (decision 37), which
 * reads these settings from `~/.config/caliper/config.json` as `"agent"`. The
 * API key never goes in the settings: the app reads it from its own
 * environment variable `apiKeyEnv`.
 */
export type AgentOptions = {
  /** The model id the endpoint knows, for example "gpt-5" or "claude-opus-4-8". */
  readonly model: string
  /**
   * The endpoint's base URL. For an OpenAI API, include its `/v1`, for example
   * "http://localhost:11434/v1"; it has no default. For `anthropic` and
   * `google`, the default is the provider's own endpoint.
   */
  readonly baseUrl?: string
  /** Default: "medium". Caliper passes it to the model on every request. */
  readonly reasoning?: ReasoningLevel
  /** Default: "chat-completions". */
  readonly api?: AgentApi
  /** The environment variable that holds the API key. Default: "CALIPER_AGENT_API_KEY". */
  readonly apiKeyEnv?: string
  /**
   * The model's context window, in tokens. Default: pi-ai's value for a model
   * it knows on `anthropic` or `google`, else 200,000.
   */
  readonly contextWindow?: number
  /** The most tokens one answer may use. Default: pi-ai's value for a known model, else 32,000. */
  readonly maxTokens?: number
  /**
   * Agent Skills (SKILL.md folders, https://agentskills.io) for the agent.
   * Caliper always looks in `.agents/skills/` of the project and its parent
   * folders up to the Git root, then in `~/.agents/skills/`. A list adds
   * folders: a folder of skills or one skill's folder, absolute or starting
   * with `~/`. The object form also chooses skills
   * by name. `false` turns skills off.
   */
  readonly skills?: false | readonly string[] | SkillOptions
}

/** Which skills the agent gets. */
export type SkillOptions = {
  /** More folders to look in, as in the list form of `skills`. */
  readonly folders?: readonly string[]
  /** Only these skills, by name. Default: every skill found. */
  readonly include?: readonly string[]
  /** Never these skills, by name. */
  readonly exclude?: readonly string[]
}

/** One skill the agent can load. */
export type SkillSummary = {
  readonly name: string
  readonly description: string
  /** Where Caliper found it: the project, `agent.skills`, or `~/.agents/skills`. */
  readonly scope: "project" | "configured" | "user"
  /** SKILL.md, relative to the project root, under `~`, or absolute. */
  readonly location: string
}

/** The skills the agent can load, and what Caliper could not load. */
export type SkillsStatus = {
  readonly skills: readonly SkillSummary[]
  readonly problems: readonly string[]
}

/** What the chrome knows about the agent. It never holds the key. */
export type AgentStatus =
  | { readonly _tag: "Off"; readonly hint: string }
  | {
      readonly _tag: "Ready"
      readonly model: string
      readonly baseUrl: string
      readonly reasoning: ReasoningLevel
      readonly api: AgentApi
      /** Where the base URL came from, for example "~/.config/caliper/config.json". */
      readonly baseUrlFrom: string
      /** Where the key came from, for example "CALIPER_AGENT_API_KEY". */
      readonly keyFrom: string
    }
  | { readonly _tag: "Failed"; readonly reason: string; readonly hint: string }

/** Whether a take's agent is working. */
export type TakeRun =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Running" }
  | { readonly _tag: "Failed"; readonly reason: string }

/** One line of a take's conversation, as the chrome shows it. */
export type TakeLogEntry =
  /** `images` are the files of `TakeView.images` this prompt attached. */
  | { readonly _tag: "User"; readonly text: string; readonly images?: readonly string[] }
  | { readonly _tag: "Assistant"; readonly text: string }
  | {
      readonly _tag: "Tool"
      readonly id: string
      readonly name: string
      /** What the tool works on, for example a file path or "default@rg353m". */
      readonly subject: string
      readonly outcome: "Running" | "Done" | "Failed"
      /** The result in a few words, or the error. */
      readonly detail: string
    }
  /** You changed a file of the take by hand, in the code pane. */
  | { readonly _tag: "Edit"; readonly file: string }

/** One way to answer a prompt. The planner proposes them; each take follows one. */
export type Direction = {
  /** A few words, for example "Use the shared fixtures". */
  readonly title: string
  /** One to three sentences: what the take changes and how it differs from the others. */
  readonly brief: string
  /** Present on the one direction that breaks the part's current pattern on purpose (decision 33). */
  readonly strange?: true
}

/** What the planner proposes for one prompt. */
export type TakePlan = {
  readonly directions: readonly Direction[]
  /** Why the plan has fewer directions than asked for, when it does. */
  readonly note?: string
}

/** An image you attached to a prompt of a take. It is reference material, never a project file. */
export type TakeImage = {
  /** The file in the take's image folder, for example "1.png". */
  readonly file: string
  /** The name the image had when you attached it. */
  readonly name: string
  readonly mimeType: import("./client/images.js").ImageType
}

/** One take, as the chrome shows it. */
export type TakeView = {
  readonly take: string
  /** The editing subject, independent of the composed preview. */
  readonly part: string
  readonly state: string
  /** The product-owned scenario used for the initial preview. Absent for isolated takes. */
  readonly context?: StateRef
  readonly device: string
  readonly created: number
  /** Generated descriptive name. Old records can omit it. */
  readonly name?: string
  readonly nameIssue?: string
  /** A separately prepared alternate, never accepted through replacement. */
  readonly integration?: { readonly _tag: "Preparing"; readonly sourceTake: string } | { readonly _tag: "Review"; readonly sourceTake: string; readonly proposal: import("./takes/integration.js").IntegrationProposal }
  /** The planner's direction for this take, when one prompt started several. */
  readonly direction?: Direction
  /**
   * Only for a take made from marks: the take it was made from, the chain's
   * first take, and every ancestor from that first take to the parent. The
   * ancestors may since be discarded.
   */
  readonly parent?: { readonly take: string; readonly created: number }
  readonly chain?: { readonly take: string; readonly created: number }
  readonly lineage?: readonly { readonly take: string; readonly created: number }[]
  readonly run: TakeRun
  /** The files the take changes, root-relative. */
  readonly files: readonly string[]
  /** Every image attached to the take's prompts, oldest first. */
  readonly images: readonly TakeImage[]
  readonly log: readonly TakeLogEntry[]
}

/** One idea of a workspace, as the board shows it (decision 45). It is a take with no part. */
export type IdeaView = {
  readonly take: string
  readonly created: number
  /** Where the idea's agent renders by default. */
  readonly device: string
  readonly name?: string
  /** The planner's direction, or the one you wrote for a new idea. */
  readonly direction?: Direction
  readonly run: TakeRun
  /** The files the idea changes, root-relative. */
  readonly files: readonly string[]
  readonly images: readonly TakeImage[]
  readonly log: readonly TakeLogEntry[]
}

export type Workspace = import("./takes/workspaces.js").Workspace

/** A scratch row's file, as its source declares it, and the row agent that writes it (slice 2). */
export type ScratchView = import("./takes/workspaces.js").ScratchFacts & { readonly run: TakeRun; readonly log: readonly TakeLogEntry[] }
/** How one row's checks went in one column of a board (slice 2). */
export type CellCheck = import("typebox").Static<typeof import("./takes/workspace-contract.js").CellCheckSchema>

/**
 * A workspace and its ideas, oldest first, its scratch rows in board order,
 * and its checks in cells; or a workspace file Caliper cannot read, and why.
 */
export type WorkspaceView =
  | (Workspace & { readonly _tag: "Ready"; readonly ideas: readonly IdeaView[]; readonly scratch: readonly ScratchView[]; readonly checks: readonly CellCheck[] })
  | { readonly _tag: "Damaged"; readonly id: string; readonly reason: string }

/** What the event stream sends as `takes`. */
export type TakesSnapshot = {
  readonly agent: AgentStatus
  readonly skills: SkillsStatus
  /** The takes of parts. Ideas are only in `workspaces`. */
  readonly takes: readonly TakeView[]
  /** The accept log, oldest first (`.caliper/accepted.json`). */
  readonly accepted: readonly import("./takes/store.js").AcceptRecord[]
  /** Every workspace, lowest number first. */
  readonly workspaces: readonly WorkspaceView[]
}

/** One file the code pane lists for a part. */
export type CodeFile = {
  /** Root-relative. */
  readonly file: string
  /** 0 for the part file, 1 for what it imports, and so on. null: the take changes the file, but the part does not import it. */
  readonly depth: number | null
  /** Whether the take changes the file. Always false for the real files. */
  readonly changed: boolean
}

/** A file as the code pane opens it. */
export type CodeDocument = {
  readonly file: string
  /** The file as the take sees it, or the real file. */
  readonly content: string
  /**
   * Only for a take: the real file, to compare with. null when the take adds
   * the file. Absent for the real files.
   */
  readonly original?: string | null
}

/** What the event stream sends as `code`: a project file, or a take's copy of one, changed on disk. */
export type CodeChange = {
  readonly file: string
  /** The take whose copy changed, or null for the real file. */
  readonly take: string | null
}

/**
 * What standard CSS cannot say about a knob (decision 26). A doc comment
 * directly above the declaration gives these, for example
 * `/** @label Pixel rows @min 180 @max 720 @step 10 *\/` or `/** @knob ignore *\/`.
 */
export type KnobHints = {
  readonly label?: string
  readonly min?: number
  readonly max?: number
  /** More than 0. */
  readonly step?: number
  /** Not a knob, although Caliper would find it. */
  readonly ignore?: boolean
}

/** Where the knobs API found a declaration a knob shows. Offsets are into the file as `version` names it. */
export type KnobSource =
  | {
    readonly _tag: "Located"
    /** Root-relative. */
    readonly file: string
    /** The value's start and end in the file, without the spaces around it. */
    readonly start: number
    readonly end: number
    /** 1-based, of `start`. */
    readonly line: number
    readonly value: string
    readonly version: string
    /** From the doc comment directly above the declaration, or above its `@property` rule. */
    readonly hints: KnobHints
    /** The comment's prose, without its hints. */
    readonly note: string
    readonly problems: readonly string[]
  }
  | { readonly _tag: "Refused", readonly reason: string }

export type CaliperOptions = {
  /**
   * Knob hints by custom property name, for CSS a project cannot annotate.
   * A doc comment above the declaration wins over these.
   */
  readonly knobs?: Readonly<Record<string, KnobHints>>
  /** The module the app starts from, relative to the Vite root. Overrides the derived entry. */
  readonly entry?: string
  /**
   * Global stylesheet paths relative to the Vite root, in injection order.
   * Replaces direct-entry CSS discovery. [] injects no globals. Components
   * still load their own styles through the selected part's imports.
   */
  readonly css?: readonly string[]
  /**
   * The class names of the app's outer shell, outermost first. Each string
   * becomes one `div`. `false` renders parts with no wrapper. Overrides the
   * derived wrapper.
   */
  readonly wrap?: string | readonly string[] | false
  /**
   * The devices to show and check, first one the default. A string names a
   * device Caliper knows, for example "iphone-16" or "rg353m"; an object
   * declares the project's own. Omit it for the standard phones, tablet,
   * laptop and monitor. Checks render every state on every device, so each
   * device adds check time.
   */
  readonly devices?: readonly (string | DeclaredDevice)[]
}

/** A device a project declares in `caliper({ devices })`. */
export type DeclaredDevice = {
  /** Stable id. Takes and marks store it. */
  readonly id: string
  readonly name: string
  /** The screen's physical size, for true size. */
  readonly widthMm: number
  readonly heightMm: number
  /** What the page sees: `window.innerWidth`, `vw`, media queries. */
  readonly cssWidth: number
  readonly cssHeight: number
  /** Where the sizes come from. */
  readonly viewportNote?: string
}
