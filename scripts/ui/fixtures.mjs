// @ts-check
/**
 * The shot list: every gallery fixture, the mockup state it answers (when the
 * mockup drew one), and the UI-owned disclosure to open before the shot. A
 * fixture the mockup did not draw has `mockup: null`; its render is the design.
 *
 * @typedef {{ fixture: string, mockup: string | null, act?: "menu" | "drawer" | "files" | "skills", note?: string }} Shot
 */

/** @type {readonly Shot[]} */
export const SHOTS = [
  { fixture: "takes", mockup: "takes" },
  { fixture: "empty", mockup: "empty" },
  { fixture: "none", mockup: null, note: "Nothing selected yet." },
  { fixture: "prompt", mockup: "menu", act: "menu" },
  { fixture: "plan", mockup: "plan" },
  { fixture: "planning", mockup: null, note: "The planner is working; the slots say so." },
  { fixture: "log", mockup: "log" },
  { fixture: "running", mockup: null, note: "Undrawn: a running take with Stop." },
  { fixture: "failedTake", mockup: null, note: "A take whose agent stopped with an error." },
  { fixture: "agentFailed", mockup: null, note: "Undrawn: the agent failed to load." },
  { fixture: "agentOff", mockup: null, note: "No agent configured." },
  { fixture: "knobs", mockup: "knobs" },
  { fixture: "knobsFinding", mockup: null },
  { fixture: "code", mockup: "code" },
  { fixture: "codeWatching", mockup: null, note: "Undrawn: the code pane follows a running take, with Stop." },
  { fixture: "codeLoading", mockup: null },
  { fixture: "codeFailed", mockup: null },
  { fixture: "grid", mockup: "grid" },
  { fixture: "error", mockup: "error" },
  { fixture: "odin", mockup: null, note: "The ODIN 2 PORTAL: scaled on small canvases, and the caption says so." },
  { fixture: "checks", mockup: "checks" },
  { fixture: "checksRunning", mockup: null },
  { fixture: "calibrate", mockup: "calibrate" },
  { fixture: "alternate", mockup: null },
  { fixture: "unreachable", mockup: null },
  { fixture: "setup", mockup: null, note: "Setup problems, a composed scenario and an unavailable state." },
  { fixture: "takes", mockup: "parts", act: "drawer" },
]

export const FIXTURE_NAMES = [...new Set(SHOTS.map(shot => shot.fixture))]
