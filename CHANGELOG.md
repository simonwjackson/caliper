# Changelog

All changes that a user can see go here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow
[Semantic Versioning](https://semver.org/). Before 1.0, a minor version can
break things.

## Unreleased

The first public release.

### Fixed

- Checks skip the generated `.direnv` cache instead of hashing linked Nix
  package trees, which could block the dev server and time out checks.

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
