# Changelog

All changes that a user can see go here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow
[Semantic Versioning](https://semver.org/). Before 1.0, a minor version can
break things.

## Unreleased

- Workspaces (decision 45): a scratch area for a question that is not about
  one part. Pin states as rows, write the question, and the planner starts
  several ideas. Each idea is a take with its own agent and files; the board
  shows every row in Today and in each idea, and dims a cell that matches
  Today. Questions and answers, with their reasons, stay after you discard the
  ideas. Ideas cannot be accepted yet. The plugin's protocol is now 4, so
  restart each project's dev server after you update the Caliper app.
- Generated check images no longer trigger Vite's unresolved-import retries and
  reload unchanged preview frames. Product files and take copies remain watched.
- Every write endpoint takes the same JSON content types. Code, knobs, takes
  and marks writes now refuse a type such as `application/json-evil`, as checks
  already did, and accept `Application/JSON`.

The first public release.

### Fixed

- Visual checks retry a complete observation after a same-frame reload instead
  of failing with "Execution context was destroyed". Retries stay bounded and
  do not replay authored input or ignore source changes.
- Caliper's self-hosting dev server skips generated direnv caches and other
  worktrees, so its file watcher does not scan Nix package trees at startup.
- Checks skip the generated `.direnv` cache instead of hashing linked Nix
  package trees, which could block the dev server and time out checks.
- A slow project host call no longer blocks the take-agent worker. Stop can
  abort a pending call without waiting for its 60-second timeout.

### Added

- The `caliper()` Vite plugin. It finds `*.part.tsx` files, the app entry, the
  global CSS and the outer shell, and serves each part state in its own frame.
- The Caliper app (`caliper`). One port shows every running project, with a
  project switcher, true-size device frames and calibration.
- Takes: an agent makes versions of a part in `.caliper/takes/<n>/`, from one
  prompt or a plan of several directions, with marks, references and skills.
- Knobs for CSS custom properties, `@container` thresholds and literals.
- A code pane that edits project files and take copies.
- Checks: repeat renders, spill, accessibility, authored browser-input checks
  and approved image baselines.
- `caliper-render`, to render and check parts from the command line.
- Renders and checks use Playwright's own Chromium when `CHROMIUM` is unset.
