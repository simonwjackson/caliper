import type { Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { tags } from "@lezer/highlight"

/*
 * The Darkroom look of the code editor and the review diff (decision 34).
 * Colours are the chrome's tokens from tokens.css, so the editor follows the
 * light and dark room with the rest of the chrome. The editor lives inside
 * `.dr-root`, where those tokens are defined. Syntax colours stay quiet: the
 * part on the canvas is the only strong colour on screen.
 *
 * Classes this styles that core's editor emits: cm-cal-watching,
 * cm-cal-revert, cm-cal-lens and cm-cal-arrived, and the merge view's
 * changed and deleted chunks.
 */
const theme = EditorView.theme({
  "&": { height: "100%", color: "var(--dr-ink)", backgroundColor: "var(--dr-card)", fontSize: "12px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--dr-mono)", lineHeight: "1.55" },
  ".cm-content": { caretColor: "var(--dr-ink)", padding: ".4rem 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--dr-ink)", borderLeftWidth: "2px" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in srgb, var(--dr-ink) 18%, transparent)",
  },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--dr-ink) 4%, transparent)" },
  ".cm-selectionMatch": { backgroundColor: "color-mix(in srgb, var(--dr-ink) 10%, transparent)" },
  "&.cm-focused .cm-matchingBracket": { backgroundColor: "color-mix(in srgb, var(--dr-ink) 12%, transparent)", outline: "1px solid var(--dr-edge-2)" },
  ".cm-gutters": { backgroundColor: "var(--dr-card)", color: "var(--dr-ink-3)", border: "none" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--dr-ink-2)" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 .8rem 0 .6rem", minWidth: "3rem" },
  ".cm-foldGutter .cm-gutterElement": { color: "var(--dr-ink-3)", paddingRight: ".25rem" },
  ".cm-foldPlaceholder": { backgroundColor: "var(--dr-card-2)", border: "none", color: "var(--dr-ink-2)" },
  ".cm-tooltip": { backgroundColor: "var(--dr-card)", border: "none", borderRadius: "6px", boxShadow: "var(--dr-lift)", color: "var(--dr-ink)" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--dr-card-2)", color: "var(--dr-ink)" },
  ".cm-panels": { backgroundColor: "var(--dr-card)", color: "var(--dr-ink)", borderColor: "var(--dr-edge)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--dr-edge)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--dr-edge)" },
  ".cm-panel input, .cm-panel button": { fontSize: "var(--dr-fs-1)" },
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--dr-warn) 22%, transparent)", outline: "1px solid color-mix(in srgb, var(--dr-warn) 60%, transparent)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "color-mix(in srgb, var(--dr-warn) 40%, transparent)" },

  // The diff: a take's lines against the real file's, in good and bad at a low mix.
  "&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine": { backgroundColor: "color-mix(in srgb, var(--dr-good) 12%, transparent)" },
  "&.cm-merge-b .cm-changedText": { background: "color-mix(in srgb, var(--dr-good) 28%, transparent)" },
  ".cm-deletedChunk": { backgroundColor: "color-mix(in srgb, var(--dr-bad) 12%, transparent)", paddingLeft: ".5rem", position: "relative" },
  ".cm-deletedChunk .cm-deletedText, &.cm-merge-b .cm-deletedText": { background: "color-mix(in srgb, var(--dr-bad) 28%, transparent)" },
  ".cm-deletedLine": { color: "var(--dr-ink-2)" },
  ".cm-deletedChunk .cm-chunkButtons": { position: "sticky", float: "right", insetInlineEnd: ".5rem", marginTop: "1px", zIndex: "1", lineHeight: "1" },
  ".cm-deletedChunk:not(:has(.cm-deletedLine))": { backgroundColor: "transparent", padding: "0", height: "0" },
  "&.cm-cal-watching .cm-chunkButtons": { display: "none" },
  "&.cm-cal-watching .cm-content": { caretColor: "transparent" },
  ".cm-changedLineGutter": { background: "var(--dr-good) !important" },
  ".cm-deletedLineGutter": { background: "var(--dr-bad) !important" },
  ".cm-changeGutter": { width: "3px", paddingLeft: "0" },
  ".cm-collapsedLines": {
    color: "var(--dr-ink-3)", background: "var(--dr-card-2) !important", fontFamily: "var(--dr-sans)", fontSize: "11px",
    padding: ".2rem .85rem", borderBlock: "1px solid var(--dr-edge)",
  },
  ".cm-collapsedLines:hover": { color: "var(--dr-ink)" },
  ".cm-collapsedLines:before": { content: '"↕"' },
  ".cm-collapsedLines:after": { content: "none" },
  ".cm-cal-revert": {
    border: "1px solid var(--dr-edge-2)", borderRadius: "4px", background: "var(--dr-card)", color: "var(--dr-ink-2)",
    font: "11px / 1.4 var(--dr-sans)", padding: "0 .4rem", cursor: "pointer",
  },
  ".cm-cal-revert:hover": { borderColor: "var(--dr-bad)", color: "var(--dr-bad)" },
  ".cm-cal-revert:focus-visible": { outline: "2px solid var(--dr-ink)", outlineOffset: "1px" },

  // Lenses above the lines that export the part's states.
  ".cm-cal-lens": { padding: ".25rem 0 0", lineHeight: "1" },
  ".cm-cal-lens button": { border: "none", background: "none", padding: "2px 0", color: "var(--dr-ink-3)", font: "11px / 1.2 var(--dr-sans)", cursor: "pointer" },
  ".cm-cal-lens button:hover": { color: "var(--dr-ink)", textDecoration: "underline" },
  ".cm-cal-lens button[data-current=true]": { color: "var(--dr-ink)", cursor: "default", textDecoration: "none" },
  ".cm-cal-lens button[data-current=true]::before": { content: '"• "' },

  // Text that arrived from disk: a quiet ink wash that fades (keyframes in code/code.css).
  ".cm-cal-arrived": { animation: "dr-arrived 1.6s ease-out" },
})

const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.moduleKeyword, tags.controlKeyword, tags.operatorKeyword, tags.definitionKeyword], color: "color-mix(in srgb, #c69cff 70%, var(--dr-ink))" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "color-mix(in srgb, #a8d49a 70%, var(--dr-ink))" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom, tags.unit], color: "color-mix(in srgb, #f2b872 75%, var(--dr-ink))" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], color: "var(--dr-ink-3)", fontStyle: "italic" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "color-mix(in srgb, #8ec5ff 65%, var(--dr-ink))" },
  { tag: [tags.tagName, tags.angleBracket], color: "color-mix(in srgb, #9dbcff 70%, var(--dr-ink))" },
  { tag: [tags.attributeName], color: "color-mix(in srgb, #f2b872 60%, var(--dr-ink))" },
  { tag: [tags.propertyName, tags.special(tags.propertyName)], color: "color-mix(in srgb, #9dbcff 70%, var(--dr-ink))" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--dr-ink)" },
  { tag: [tags.definition(tags.variableName), tags.definition(tags.propertyName), tags.variableName, tags.self], color: "var(--dr-ink)" },
  { tag: [tags.operator, tags.punctuation, tags.separator, tags.bracket], color: "var(--dr-ink-2)" },
  { tag: [tags.meta, tags.processingInstruction, tags.annotation], color: "var(--dr-ink-2)" },
  { tag: tags.invalid, color: "var(--dr-bad)" },
])

/** Opus-owned styling seam. Core includes these extensions in editors and review diffs. */
export const editorAppearance: readonly Extension[] = [theme, syntaxHighlighting(highlight)]
