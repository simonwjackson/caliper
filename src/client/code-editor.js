// @ts-check
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete"
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { css } from "@codemirror/lang-css"
import { javascript } from "@codemirror/lang-javascript"
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language"
import { Chunk, getChunks, goToNextChunk, goToPreviousChunk, originalDocChangeEffect, unifiedMergeView } from "@codemirror/merge"
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search"
import { Annotation, ChangeSet, Compartment, EditorState, RangeSetBuilder, StateEffect, StateField, Text, Transaction } from "@codemirror/state"
import {
  Decoration,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  WidgetType,
} from "@codemirror/view"
import { editorAppearance } from "./ui/editor-appearance"
import { CAL } from "./ui/hooks"

/**
 * Caliper's code editor: CodeMirror 6, composed from its own packages and
 * with appearance supplied by the chrome UI.
 *
 * It knows nothing about takes or the server. The code pane tells it which
 * file to show and in which mode, and hears about edits through hooks.
 *
 * @typedef {{ _tag: "Real" }
 *   | { _tag: "Take", original: string | null }
 *   | { _tag: "Watching", original: string | null }} Mode
 *   `Real`: the real file. Edits save directly to the project.
 *   `Take`: edits save to the take, shown against the real file. `Watching`: the take's agent is editing, so you only watch.
 *   `original` is null when the take adds the file.
 * @typedef {{ export: string, label: string, current: boolean }} Lens
 *   One state of the part, shown above the line that exports it.
 * @typedef {{
 *   onEdit: (content: string) => void,
 *   onSave: () => void,
 *   onSelectState: (exportName: string) => void,
 *   onChanges: (count: number) => void,
 * }} Hooks
 *   `onEdit` fires after every change you make, not after changes from disk.
 *   `onChanges` reports how many changed chunks the diff shows.
 * @typedef {{ key: string, file: string, content: string, mode: Mode, lenses: readonly Lens[] }} Opened
 */

/** Marks a transaction that brings the file on disk into the editor. */
/** @type {import("@codemirror/state").AnnotationType<boolean>} */
const fromDisk = Annotation.define()
/** @type {import("@codemirror/state").StateEffectType<readonly Lens[]>} */
const setLenses = StateEffect.define()
/** @type {import("@codemirror/state").StateEffectType<null>} */
const clearArrivals = StateEffect.define()
/** How long text that arrives from disk stays marked. */
const ARRIVAL_MS = 1600

/**
 * @param {HTMLElement} parent
 * @param {Hooks} hooks
 */
export function createEditor(parent, hooks) {
  const language = new Compartment()
  const mode = new Compartment()
  const diff = new Compartment()
  /** @type {Map<string, EditorState>} */
  const states = new Map()
  /** @type {Map<string, StateEffect<unknown>>} */
  const scrolls = new Map()
  /** The mode each kept state was last configured for. @type {Map<string, Mode>} */
  const modes = new Map()
  /** @type {string | null} */
  let key = null
  /** @type {Mode} */
  let currentMode = { _tag: "Real" }
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let arrivalTimer
  let destroyed = false

  const view = new EditorView({
    parent,
    dispatchTransactions(transactions, editor) {
      editor.update(transactions)
      if (transactions.some(tr => tr.docChanged && tr.annotation(fromDisk) === undefined)) hooks.onEdit(editor.state.doc.toString())
      if (transactions.some(tr => tr.docChanged || tr.reconfigured)) reportChanges()
    },
  })

  const reportChanges = () => {
    const chunks = getChunks(view.state)?.chunks.length ?? 0
    // With no change left, nothing is worth folding away: show the whole file.
    if (chunks === 0 && view.state.field(collapsing, false)) {
      queueMicrotask(() => { if (!destroyed) view.dispatch({ effects: diff.reconfigure(diffExtensions(currentMode, false)) }) })
    }
    hooks.onChanges(chunks)
  }

  /** @param {Opened} opened */
  const extensions = opened => [
    lineNumbers(),
    foldGutter({ openText: "▾", closedText: "▸" }),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([
      { key: "Mod-s", run: () => (hooks.onSave(), true), preventDefault: true },
      { key: "Alt-ArrowDown", run: goToNextChunk },
      { key: "Alt-ArrowUp", run: goToPreviousChunk },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
    editorAppearance,
    arrivals,
    lensField(hooks.onSelectState),
    language.of(languageFor(opened.file)),
    mode.of(modeExtensions(opened.mode)),
    // Opening a file the take changes folds the lines around the changes, for review.
    diff.of(diffExtensions(opened.mode, originalOf(opened.mode) != null && originalOf(opened.mode) !== opened.content)),
  ]

  /**
   * Show a file. A file shown before comes back with its undo history,
   * selection and scroll; if the file on disk changed since, the change is
   * applied on top.
   *
   * @param {Opened} opened
   */
  const open = opened => {
    if (opened.key === key) {
      setMode(opened.mode)
      view.dispatch({ effects: setLenses.of(opened.lenses) })
      replaceFromDisk(opened.content, false)
      reportChanges()
      return
    }
    if (key !== null) {
      states.set(key, view.state)
      scrolls.set(key, view.scrollSnapshot())
      modes.set(key, currentMode)
    }
    key = opened.key
    const cached = states.get(opened.key)
    view.setState(cached ?? EditorState.create({ doc: opened.content, extensions: extensions(opened) }))
    currentMode = (cached && modes.get(opened.key)) || opened.mode
    setMode(opened.mode)
    view.dispatch({ effects: setLenses.of(opened.lenses) })
    if (cached) {
      replaceFromDisk(opened.content, false)
      const scroll = scrolls.get(opened.key)
      if (scroll) view.dispatch({ effects: scroll })
    }
    reportChanges()
  }

  /**
   * Change what edits do, and what the diff compares with, without touching
   * the text or its history.
   *
   * @param {Mode} next
   */
  const setMode = next => {
    const before = originalOf(currentMode)
    const after = originalOf(next)
    const effects = [mode.reconfigure(modeExtensions(next))]
    if (before === undefined || after === undefined || before === null || after === null) {
      // The diff starts, stops, or switches between an added file and a changed one.
      // It never folds here: you may be typing the first change.
      if (before !== after || currentMode._tag !== next._tag) effects.push(diff.reconfigure(diffExtensions(next, false)))
    } else if (currentMode._tag !== next._tag) {
      effects.push(diff.reconfigure(diffExtensions(next, false)))
    } else if (before !== after) {
      effects.push(originalDocChangeEffect(view.state, changesBetween(before, after)))
    }
    currentMode = next
    view.dispatch({ effects })
  }

  /**
   * Bring the file on disk into the editor with the smallest change, so the
   * cursor and scroll stay where they are. It does not enter the undo
   * history: undo takes back only your own edits.
   *
   * @param {string} content
   * @param {boolean} mark whether to mark the arrived text for a moment
   */
  const replaceFromDisk = (content, mark) => {
    const current = view.state.doc.toString()
    if (current === content) return
    view.dispatch({
      changes: changesBetween(current, content),
      annotations: [fromDisk.of(mark), Transaction.addToHistory.of(false)],
    })
    if (mark) {
      clearTimeout(arrivalTimer)
      arrivalTimer = setTimeout(() => view.dispatch({ effects: clearArrivals.of(null) }), ARRIVAL_MS)
    }
  }

  return {
    open,
    setMode,
    replaceFromDisk,
    /** @param {readonly Lens[]} lenses */
    setLenses: lenses => view.dispatch({ effects: setLenses.of(lenses) }),
    /** @param {string} exportName */
    revealState: exportName => {
      const line = stateLine(view.state.doc, exportName)
      if (line === null) return
      const at = view.state.doc.line(line).from
      // Centre the line by scrolling only down or up. scrollIntoView measures
      // the state's lens widget, which is as wide as the longest line, and
      // scrolls the editor sideways to show it.
      view.requestMeasure({
        read: editor => {
          const block = editor.lineBlockAt(at)
          return block.top + block.height / 2 + editor.documentPadding.top
        },
        write: (middle, editor) => {
          editor.scrollDOM.scrollTop = Math.max(0, middle - editor.scrollDOM.clientHeight / 2)
        },
      })
    },
    nextChange: () => goToNextChunk(view),
    previousChange: () => goToPreviousChunk(view),
    focus: () => view.focus(),
    destroy: () => {
      destroyed = true
      clearTimeout(arrivalTimer)
      states.clear()
      scrolls.clear()
      modes.clear()
      view.destroy()
    },
  }
}

/**
 * A read-only diff of one file, for review: the lines a change removes sit
 * above the lines it adds, long unchanged runs fold away, and the colours are
 * the code pane's. A new file shows every line as added.
 *
 * @param {HTMLElement} parent
 * @param {{ path: string, before: string | null, after: string }} change
 * @returns {{ destroy: () => void }}
 */
export function createDiffView(parent, { path, before, after }) {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: after,
      extensions: [
        lineNumbers(),
        highlightSpecialChars(),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        editorAppearance,
        languageFor(path),
        unifiedMergeView({
          original: before ?? "",
          gutter: true,
          highlightChanges: true,
          syntaxHighlightDeletions: true,
          mergeControls: false,
          collapseUnchanged: { margin: 3, minSize: 6 },
        }),
      ],
    }),
  })
  return { destroy: () => view.destroy() }
}

/**
 * How many lines a take adds and removes, as the file list shows it.
 *
 * @param {string | null} original null when the take adds the file
 * @param {string} content
 * @returns {{ added: number, removed: number }}
 */
export function lineChanges(original, content) {
  const after = Text.of(content.split("\n"))
  if (original === null) return { added: lineCount(content), removed: 0 }
  const before = Text.of(original.split("\n"))
  let added = 0
  let removed = 0
  for (const chunk of Chunk.build(before, after)) {
    removed += spannedLines(before, chunk.fromA, chunk.toA)
    added += spannedLines(after, chunk.fromB, chunk.toB)
  }
  return { added, removed }
}

/**
 * The lines a chunk side covers, as the diff draws them. An empty line counts.
 * `to` is one past the last line's end, and may be one past the document.
 *
 * @param {Text} doc
 * @param {number} from
 * @param {number} to
 */
function spannedLines(doc, from, to) {
  if (to <= from) return 0
  return doc.lineAt(Math.min(to - 1, doc.length)).number - doc.lineAt(from).number + 1
}

/** @param {string} text */
function lineCount(text) {
  if (text === "") return 0
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0)
}

/**
 * The smallest set of changes that turns `from` into `to`.
 *
 * @param {string} from
 * @param {string} to
 */
function changesBetween(from, to) {
  const a = Text.of(from.split("\n"))
  const b = Text.of(to.split("\n"))
  /** @type {Array<{ from: number, to: number, insert: string }>} */
  const changes = []
  for (const chunk of Chunk.build(a, b)) {
    for (const change of chunk.changes) {
      changes.push({
        from: chunk.fromA + change.fromA,
        to: chunk.fromA + change.toA,
        insert: b.sliceString(chunk.fromB + change.fromB, chunk.fromB + change.toB),
      })
    }
  }
  return ChangeSet.of(changes, a.length)
}

/** @param {Mode} mode @returns {string | null | undefined} undefined when nothing is compared */
function originalOf(mode) {
  return mode._tag === "Real" ? undefined : mode.original
}

/**
 * While an agent edits, only the file on disk may change the text. That also
 * stops a Revert button, which changes the text directly.
 *
 * @param {Mode} mode
 */
function modeExtensions(mode) {
  if (mode._tag !== "Watching") return []
  return [
    EditorState.readOnly.of(true),
    EditorState.transactionFilter.of(tr => (tr.docChanged && tr.annotation(fromDisk) === undefined ? [] : tr)),
    EditorView.editorAttributes.of({ class: "cm-cal-watching" }),
  ]
}

/**
 * A take shows the real file's lines that it removed above the lines it
 * adds. Each change has a Revert button that puts the real file's lines back
 * into the take. There is no per-change accept: accepting a take is the
 * take's action, not the editor's.
 *
 * @param {Mode} mode
 * @param {boolean} collapse fold long runs of unchanged lines
 */
function diffExtensions(mode, collapse) {
  if (mode._tag === "Real" || mode.original === null) return []
  return [collapsing.init(() => collapse), unifiedMergeView({
    original: mode.original,
    gutter: true,
    highlightChanges: true,
    syntaxHighlightDeletions: true,
    ...(collapse ? { collapseUnchanged: { margin: 3, minSize: 6 } } : {}),
    mergeControls: (type, action) => {
      if (type === "accept") return document.createElement("span")
      const button = document.createElement("button")
      button.type = "button"
      button.disabled = mode._tag === "Watching"
      button.className = "cm-cal-revert"
      button.textContent = "Revert"
      button.title = "Put the real file's lines back in this take"
      button.addEventListener("mousedown", event => {
        if (mode._tag !== "Watching") action(event)
      })
      return button
    },
  })]
}

/** Whether the diff folds unchanged lines. Read to unfold once no change is left. */
const collapsing = StateField.define({
  create: () => false,
  update: value => value,
})

/** @param {string} file */
function languageFor(file) {
  if (/\.(m|c)?(t|j)sx?$/.test(file)) return javascript({ jsx: /x$/.test(file), typescript: /\.(m|c)?tsx?$/.test(file) })
  if (/\.(css|pcss|postcss)$/.test(file)) return css()
  return []
}

// ------------------------------------------------------------------ arrivals

/**
 * Text that arrived from disk, for example an agent's edit, is marked for a
 * moment, so you see where the file changed.
 */
const arrivals = StateField.define({
  create: () => Decoration.none,
  update(marks, tr) {
    if (tr.effects.some(effect => effect.is(clearArrivals))) return Decoration.none
    let next = marks.map(tr.changes)
    if (tr.annotation(fromDisk) === true) {
      /** @type {Array<import("@codemirror/state").Range<Decoration>>} */
      const ranges = []
      tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
        if (toB > fromB) ranges.push(arrived.range(fromB, toB))
      })
      next = next.update({ add: ranges, sort: true })
    }
    return next
  },
  provide: field => EditorView.decorations.from(field),
})

const arrived = Decoration.mark({ class: "cm-cal-arrived" })

// --------------------------------------------------------------------- lenses

/**
 * Above the line that exports each state, a lens shows the state's name.
 * Click it to show that state on the stage. The state on the stage says so.
 *
 * @param {(exportName: string) => void} select
 */
function lensField(select) {
  return StateField.define({
    create: () => /** @type {{ lenses: readonly Lens[], decorations: import("@codemirror/view").DecorationSet }} */ ({ lenses: [], decorations: Decoration.none }),
    update(value, tr) {
      /** @type {readonly Lens[]} */
      let lenses = value.lenses
      for (const effect of tr.effects) if (effect.is(setLenses)) lenses = effect.value
      if (lenses === value.lenses && !tr.docChanged) return value
      return { lenses, decorations: lensDecorations(tr.state.doc, lenses, select) }
    },
    provide: field => EditorView.decorations.from(field, value => value.decorations),
  })
}

/**
 * @param {Text} doc
 * @param {readonly Lens[]} lenses
 * @param {(exportName: string) => void} select
 */
function lensDecorations(doc, lenses, select) {
  const placed = lenses
    .map(lens => ({ lens, line: stateLine(doc, lens.export) }))
    .filter(/** @returns {entry is { lens: Lens, line: number }} */ entry => entry.line !== null)
    .sort((left, right) => left.line - right.line)
  const builder = new RangeSetBuilder()
  for (const { lens, line } of placed) {
    const at = doc.line(line).from
    builder.add(at, at, Decoration.widget({ widget: new LensWidget(lens, select), block: true, side: -1 }))
  }
  return /** @type {import("@codemirror/view").DecorationSet} */ (builder.finish())
}

/**
 * The 1-based line that exports a state, or null. Caliper reads states from
 * `export default` and from exported functions and arrow functions whose
 * names start with an upper-case letter.
 *
 * @param {Text} doc
 * @param {string} exportName
 * @returns {number | null}
 */
function stateLine(doc, exportName) {
  const pattern = exportName === "default"
    ? /^export\s+default\b/
    : new RegExp(`^export\\s+(?:(?:async\\s+)?function\\s*\\*?\\s*|(?:const|let|var)\\s+)${exportName}\\b`)
  for (let number = 1; number <= doc.lines; number += 1) {
    if (pattern.test(doc.line(number).text)) return number
  }
  return null
}

class LensWidget extends WidgetType {
  /**
   * @param {Lens} lens
   * @param {(exportName: string) => void} select
   */
  constructor(lens, select) {
    super()
    this.lens = lens
    this.select = select
  }

  /** @param {LensWidget} other */
  eq(other) {
    return other.lens.export === this.lens.export && other.lens.label === this.lens.label && other.lens.current === this.lens.current
  }

  toDOM() {
    const row = document.createElement("div")
    row.className = "cm-cal-lens"
    const button = document.createElement("button")
    button.type = "button"
    button.dataset.current = String(this.lens.current)
    button.dataset.cal = CAL.state
    button.dataset.state = this.lens.export
    button.setAttribute("aria-current", String(this.lens.current))
    button.textContent = this.lens.current ? `On the stage · ${this.lens.label}` : `Show ${this.lens.label}`
    button.title = this.lens.current ? "The stage shows this state" : `Show the state “${this.lens.label}” on the stage`
    button.addEventListener("mousedown", event => {
      event.preventDefault()
      this.select(this.lens.export)
    })
    row.append(button)
    return row
  }

  ignoreEvent() {
    return true
  }
}
