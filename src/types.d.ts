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
      readonly option: "entry" | "wrap"
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

/** One stylesheet the app loads as a side effect of importing it. */
export type GlobalStylesheet = {
  readonly file: string
  readonly importedAt: SourceSite
}

/** An import Caliper could not resolve while it walked the entry's imports. */
export type UnresolvedImport = {
  readonly specifier: string
  readonly at: SourceSite
}

export type GlobalCss = {
  /** In the order the app loads them. */
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

export type Part = {
  /** Root-relative path, for example "src/ui/atoms/PicoButton.atom.part.tsx". */
  readonly file: string
  /** The part's `export const name`, or a name made from the file name. */
  readonly name: string
  /** The part's `export const note`, when it has one. */
  readonly note?: string
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
  /** URLs of the global stylesheets. */
  readonly css: readonly string[]
  readonly wrapper: readonly WrapperElement[]
  /** URL of the module that re-exports the project's own React. */
  readonly react: string
}

/** Resolves an import the way the project's Vite does. Returns an absolute file path, or null. */
export type Resolve = (specifier: string, importer: string) => Promise<string | null>

export type CaliperOptions = {
  /** The module the app starts from, relative to the Vite root. Overrides the derived entry. */
  readonly entry?: string
  /**
   * The class names of the app's outer shell, outermost first. Each string
   * becomes one `div`. `false` renders parts with no wrapper. Overrides the
   * derived wrapper.
   */
  readonly wrap?: string | readonly string[] | false
}
