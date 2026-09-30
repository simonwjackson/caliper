/** Fixed behavioral hooks. UI classes, hierarchy and layout remain Opus-owned. */
export const CAL = Object.freeze({
  root: "chrome", connection: "connection", tool: "tool", nav: "parts", navToggle: "parts-toggle",
  filter: "parts-filter", part: "part", partExpand: "part-expand", state: "state", compare: "compare-takes", navTake: "nav-take",
  context: "scenario-context", subject: "scenario-subject", whole: "scenario-whole", unavailable: "unavailable-states", setup: "setup",
  canvas: "canvas", frame: "frame", frameSelect: "frame-select", frameProblem: "frame-problem", caption: "caption", device: "device",
  plan: "plan", directionTitle: "direction-title", directionBrief: "direction-brief", directionRemove: "direction-remove", planBack: "plan-back", planStart: "plan-start",
  composer: "composer", prompt: "prompt", attach: "attach", attachments: "attachments", attachmentRemove: "attachment-remove", count: "take-count", start: "take-start", follow: "take-follow", agent: "agent-status", skills: "agent-skills",
  accept: "take-accept", discard: "take-discard", stop: "take-stop", alternate: "take-alternate", record: "take-record", recordClose: "record-close", log: "take-log",
  integration: "integration", review: "integration-review", integrationCheck: "integration-check", behaviorReviewed: "integration-attestation", applyAlternate: "integration-apply", reviewDiff: "review-diff",
  code: "code", fileMenu: "code-files", fileFilter: "code-file-filter", file: "code-file", codeStatus: "code-status", codeRetry: "code-retry", editor: "code-editor", previousChange: "code-previous-change", nextChange: "code-next-change", codeSave: "code-save", codeShare: "code-share",
  knobs: "knobs", knob: "knob", knobValue: "knob-value", knobSlider: "knob-slider", knobColor: "knob-color", knobChoice: "knob-choice", knobToken: "knob-token", knobStatus: "knob-status", sourceFile: "source-file",
  literals: "literals", literal: "literal", literalOpen: "literal-open", literalName: "literal-name", literalHome: "literal-home", literalCancel: "literal-cancel", promote: "literal-promote",
  checks: "checks", checksClose: "checks-close", checkRun: "check-run", checkStop: "check-stop", checkRow: "check-row", finding: "check-finding", evidence: "check-evidence", imageReviewed: "check-image-reviewed", approveImage: "check-image-approve", report: "check-report",
  markup: "markup", markMode: "mark-mode", markSurface: "mark-surface", markPoint: "mark-point", markRegion: "mark-region", markPin: "mark-pin", markEdit: "mark-edit", markNote: "mark-note", markRemove: "mark-remove", markReplace: "mark-replace", markEditorClose: "mark-editor-close", draftOpen: "draft-open", draft: "mark-draft", send: "marks-send",
  chain: "chain", chainHistory: "chain-history", chainStep: "chain-step", chainFlag: "chain-flag", chainSolo: "chain-solo",
  calibration: "calibration", calibrationScale: "calibration-scale", calibrationReset: "calibration-reset", calibrationClose: "calibration-close",
} as const)
export type CalHook = typeof CAL[keyof typeof CAL]
export function calSelector(hook: CalHook): string { return `[data-cal="${hook}"]` }
