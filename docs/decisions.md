# Decisions

These decisions shaped the fresh start on 2026-09-26. The `legacy` branch holds
the earlier Caliper: a multi-project launcher, per-project descriptors and
adapters, and a design studio. It grew to about 40,800 lines, and loading a
project stopped being reliable. Change a decision below only with new evidence,
and record the change here.

| # | Decision | Why |
|---|---|---|
| 1 | Caliper is a dev-only Vite plugin, `caliper()`, with `apply: "serve"`. The project adds it to its own `vite.config`. There is no launcher, CLI, profile or descriptor. | The project's own Vite config already runs its CSS pipeline, aliases and plugins. Legacy never ran it, so each project needed hand-written copies that drifted. This reverses legacy's rule that Caliper must not appear in the project. A dev-only config line is honest wiring. |
| 2 | Near-zero config. Caliper derives the parts, the app entry, the global CSS and the wrapper from source, without running JavaScript. | Every hand-written setting is a setting that can go stale. |
| 3 | Caliper shows each derived value and the file and line it came from. A failed derivation is visible and names its fix. | A heuristic that fails silently renders an unstyled frame with no explanation. |
| 4 | `caliper({ entry, wrap })` exist only as overrides for failed derivations. | Options stay in the one file the project already has. |
| 5 | `*.part.tsx` files are product. They stay in the project and are the default part glob. | Only the product knows what realistic example data is. |
| 6 | Each part renders in one `iframe` per device, sized to the device's CSS viewport and scaled to its physical width. | A scaled `div` gives container queries the device, but media queries, `vw` and `window` still see the monitor. The `iframe` also keeps Caliper's code apart from the project's React. |
| 7 | Credit-card calibration gives px per mm, stored in the browser. It holds at 100% browser zoom. | One measurement per monitor makes millimetres real. |
| 8 | Every failure shows a visible error. A frame drawn smaller than true size says so. | "It rendered" is not the same as "it rendered correctly". |
| 9 | The first scope is a part list, one device frame, calibration and reload on save. | Legacy built the studio before loading was reliable. |
| 10 | Caliper's chrome is plain DOM with no framework. | It must not share React, or anything else, with the project. |
| 11 | No request interception and no fetch swapping. A part supplies its own data. | Legacy rule D8, kept. |
