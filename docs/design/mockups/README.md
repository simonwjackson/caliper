# Visual direction: Darkroom (second pass)

The chosen direction for Caliper's chrome, 2026-09-28. Two other directions
(Bench, Tiles) were shown and dropped the same day; they are in this folder's
history at `9804fd3`. The first Darkroom pass is at `ccbda2b`.

`b-darkroom.html` is one page. `?state=` picks the state and `b.css` is the
one stylesheet. Sections that changed in the second pass live in `parts/` and
`assemble.mjs` splices them in. `index.html` is the gallery; `out/` holds
every render at desk (1600 × 1000) and folded phone (416 × 640), light and
dark.

## What changed in the second pass, and why

| Feedback | Change |
|---|---|
| The items around takes felt like noise | Takes moved out of the panel onto the canvas, in one row beside the real files. Under a frame there is only its name and a dot if a check failed. The right panel is gone in that state. Accept, Discard and Revise sit in the one bar at the bottom, with the composer. |
| Need to see takes together and comment on what works | Click a take to focus it; drop numbered pins on the image, each with a note. "Revise from notes" sends them to the agent. Staged, not built. |
| Not keen on the yellow | No accent hue. Selection, focus, the live knob and the primary button use ink. The product is the only colour on screen. `?accent=sky` keeps one cool alternative for comparison. |
| Checks modal: less slop | Donut, badge pills and footer copy removed. One total line, then a glyph column (tick, cross, dash) per group. Failed group first with its reason inline. |
| Knobs: show, do not tell | Sliders for numbers. The whole 16-colour palette is the control for a colour. A container threshold is a bar with the threshold mark and a "now" line for the part's current size. Only the live knob shows its source path. Skipped outputs fold into one line. |

## States

| `?state=` | Shows |
|---|---|
| `takes` | Real files and three takes on the canvas, take 1 focused with two pins |
| `empty` | First run: the real files, the composer, one sentence |
| `knobs` | Knobs panel: registered, thresholds, what the part reads, literals |
| `code` | Code pane under the stage with a take diff |
| `grid` | All five states side by side at true size |
| `checks` | Checks window over the room |
| `calibrate` | Credit-card outline and the scale slider |
| `error` | A part that throws: the frame carries the failure |
| `parts` | Phone only: the parts drawer |

## Run

```sh
docs/design/mockups/serve.mjs          # http://[::]:5312/, any host, all interfaces
docs/design/mockups/render.mjs         # writes out/*.png through the dev shell's Chromium
docs/design/mockups/render.mjs knobs   # one state
docs/design/mockups/assemble.mjs       # splice parts/*.html back into the page after editing
docs/design/mockups/probe.mjs b-darkroom 416 640   # prints each region's box
```

All scripts run through `nix develop`. The page loads Public Sans from
`assets/fonts/` (copied from nixpkgs), never from a CDN.

## What is real and what is staged

- The screen in every frame is one real render of Pico's Game Detail part on
  the RG353M (279 px wide, which is 72 mm at 3.875 px/mm). The other states
  and the takes are the same screen re-tinted with CSS filters.
- Pins and notes on a take, and "Revise from notes", are a proposal. Nothing
  in the chrome does this today.
- The knobs are Pico's real declarations: `--pico-pixel-rows`,
  `--pico-pixel-min`, `--pico-bg`, `--pico-accent`; the thresholds in
  `PicoGameFacts.css:27` and `PicoLaunchStage.css:118`; the roles the part
  reads. The "now 19em" marks are invented. The literal is invented.
- The code diff is invented but shaped like Pico's CSS. Check names and
  statuses match `src/client/checks-panel.js`. The error text matches the
  shape `src/client/frame.js` produces.
- On the phone, knobs and code show the ODIN 2 PORTAL, which cannot fit at
  true size, so the caption carries the scaled warning decision 8 requires.
  Takes, grid and error show the RG353M at true size.

## Rules the direction keeps

- Decision 6 and 8: one frame at true size; a scaled frame says so; a part
  that throws shows its error in the frame and in readable copy.
- Decision 10: plain HTML and CSS. `b.css` could become the chrome's CSS.
- Decision 22: layout is a function of the container. One `@container`
  rule at 44 rem reflows every state to the phone form. Every control stays
  reachable at both sizes.
- Decision 27: Knobs share the Takes region and the rail switches them. With
  takes on the canvas, "the Takes region" is the right panel that Knobs and
  Code now use alone; the decision's text would need one edit.
- `b774276`: the page does not scroll; each region scrolls inside itself.

## Costs

- Takes on the canvas need room. At 1600 wide the free room holds the real
  files plus three RG353M takes in one row; a fourth wraps. On the ODIN 2
  PORTAL (604 px each) only two fit side by side at true size, so a take
  review on that device wraps or scales, and scaling must say so.
- With no accent hue, "selected" and "live" are both ink rings. The live knob
  adds a halo to tell them apart. If that proves too quiet in use, the `sky`
  accent is one token away.
- Pins are a new interaction and a new data shape (per take, per state). The
  agent has to be told what a pin means.
- The rail hides tool names on the desk; the phone dock shows them.
