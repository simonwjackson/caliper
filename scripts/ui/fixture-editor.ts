/**
 * The gallery's stand-in for core's editor: a real CodeMirror view with the
 * Darkroom `editorAppearance`, mounted in the host the code pane gives to
 * `onEditorMount`. Production creates editors in core, never in the UI; this
 * exists so the gallery shows the real appearance and can prove that the
 * host, and the editor in it, survive stream updates and layout changes.
 */
import { EditorState } from "@codemirror/state"
import { EditorView, lineNumbers } from "@codemirror/view"
import { css } from "@codemirror/lang-css"
import { unifiedMergeView } from "@codemirror/merge"
import type { ChromeView } from "../../src/client/ui/contract"
import { editorAppearance } from "../../src/client/ui/editor-appearance"

let current: { host: HTMLDivElement; view: EditorView } | null = null
/** How many editors the gallery created; a gate reads it to prove none was recreated. */
export const editorStats = { created: 0, destroyed: 0 }

export const fixtureEditor = {
  mount(host: HTMLDivElement | null, chrome: ChromeView) {
    if (current && current.host !== host) { current.view.destroy(); editorStats.destroyed += 1; current = null }
    if (!host || current) return
    const code = chrome.code
    if (code._tag !== "Ready") return
    const original = code.mode._tag === "Real" ? undefined : code.mode.original
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: code.document.content,
        extensions: [
          lineNumbers(), css(), ...editorAppearance,
          ...(code.mode._tag === "Watching" ? [EditorState.readOnly.of(true), EditorView.editorAttributes.of({ class: "cm-cal-watching" })] : []),
          ...(typeof original === "string" ? [unifiedMergeView({ original, gutter: true, highlightChanges: true, syntaxHighlightDeletions: true, mergeControls: false })] : []),
        ],
      }),
    })
    editorStats.created += 1
    current = { host, view }
  },
}
