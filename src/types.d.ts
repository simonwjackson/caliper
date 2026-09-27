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
  readonly wrapper: readonly WrapperElement[]
  /** URL of the module that re-exports the project's own React. */
  readonly react: string
}

/** Resolves an import the way the project's Vite does. Returns an absolute file path, or null. */
export type Resolve = (specifier: string, importer: string) => Promise<string | null>

/** How hard the model thinks before it answers. `xhigh` and `max` work only on some models. */
export type ReasoningLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"

/**
 * The agent that makes takes. It runs inside the Vite dev server and talks to
 * an endpoint that speaks the OpenAI API. The API key never goes in
 * vite.config: Caliper reads it from the environment variable `apiKeyEnv`,
 * which may also be set in the project's `.env.local`.
 */
export type AgentOptions = {
  /** The model id the endpoint knows, for example "claude-opus-5-5". */
  readonly model: string
  /**
   * The endpoint's OpenAI base URL, with its `/v1`, for example
   * "https://proxy.example/v1". When it is not set, Caliper uses the base URL
   * in `~/.pi/agent/cliproxyapi.json`, if that file exists.
   */
  readonly baseUrl?: string
  /** Default: "medium". Caliper passes it to the model on every request. */
  readonly reasoning?: ReasoningLevel
  /** Which OpenAI API to call: `/chat/completions` or `/responses`. Default: "chat-completions". */
  readonly api?: "chat-completions" | "responses"
  /** The environment variable that holds the API key. Default: "CALIPER_AGENT_API_KEY". */
  readonly apiKeyEnv?: string
}

/** What the chrome knows about the agent. It never holds the key. */
export type AgentStatus =
  | { readonly _tag: "Off"; readonly hint: string }
  | {
      readonly _tag: "Ready"
      readonly model: string
      readonly baseUrl: string
      readonly reasoning: ReasoningLevel
      readonly api: "chat-completions" | "responses"
      /** Where the base URL came from, for example "vite.config". */
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
  | { readonly _tag: "User"; readonly text: string }
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

/** One way to answer a prompt. The planner proposes them; each take follows one. */
export type Direction = {
  /** A few words, for example "Use the shared fixtures". */
  readonly title: string
  /** One to three sentences: what the take changes and how it differs from the others. */
  readonly brief: string
}

/** What the planner proposes for one prompt. */
export type TakePlan = {
  readonly directions: readonly Direction[]
  /** Why the plan has fewer directions than asked for, when it does. */
  readonly note?: string
}

/** One take, as the chrome shows it. */
export type TakeView = {
  readonly take: string
  readonly part: string
  readonly state: string
  readonly device: string
  readonly created: number
  /** Generated descriptive name. Old records can omit it. */
  readonly name?: string
  readonly nameIssue?: string
  /** A separately prepared alternate, never accepted through replacement. */
  readonly integration?: { readonly _tag: "Preparing"; readonly sourceTake: string } | { readonly _tag: "Review"; readonly sourceTake: string; readonly proposal: import("./takes/integration.js").IntegrationProposal }
  /** The planner's direction for this take, when one prompt started several. */
  readonly direction?: Direction
  readonly run: TakeRun
  /** The files the take changes, root-relative. */
  readonly files: readonly string[]
  readonly log: readonly TakeLogEntry[]
}

/** What the event stream sends as `takes`. */
export type TakesSnapshot = {
  readonly agent: AgentStatus
  readonly takes: readonly TakeView[]
}

export type CaliperOptions = {
  /** The agent that makes takes. Leave it out to use Caliper as a viewer only. */
  readonly agent?: AgentOptions
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
}
