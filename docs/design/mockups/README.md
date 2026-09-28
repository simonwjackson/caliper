# Visual direction: Darkroom

The chosen direction for Caliper's chrome, 2026-09-28. Two other directions
(Bench, Tiles) were shown and dropped the same day; they are in this folder's
history at `9804fd3` if the reason ever needs revisiting.

`b-darkroom.html` is one page. `?state=` picks the state; `b.css` is the one
stylesheet. `index.html` is the gallery, and `out/` holds every render at desk
(1600 × 1000) and folded phone (416 × 640), light and dark.

| State | Shows |
|---|---|
| `takes` | Editing view, three takes, one running |
| `empty` | First run: no takes, the invitation |
| `knobs` | Knobs panel in the Takes region, four groups, one live |
| `code` | Code pane under the stage with a take diff |
| `grid` | All five states of the part side by side at true size |
| `compare` | Real files beside a take, with the verdict pill |
| `checks` | Checks window over the room |
| `calibrate` | Credit-card outline and the scale slider |
| `error` | A part that throws: the frame carries the failure |
| `parts` | Phone only: the parts drawer |

## The direction in one paragraph

The room is dark and the device is the only lit thing in it. Tools live on a
rail at the left, like a tool column. Panels are opaque cards that float over
the room with one hard edge and no blur. One accent, safelight amber, marks
only what is current: the pressed tool, the live knob, the running take, the
selected state. Everything else is grey ink on a grey card. In light mode the
room becomes a lightbox and the amber darkens to keep contrast. Type is Public
Sans with tabular numerals; mono appears only for code and CSS names.

## Run

```sh
docs/design/mockups/serve.mjs          # http://[::]:5312/, any host, all interfaces
docs/design/mockups/render.mjs         # writes out/*.png through the dev shell's Chromium
docs/design/mockups/render.mjs knobs   # one state
docs/design/mockups/probe.mjs b-darkroom 416 640   # prints each region's box
```

Both scripts run through `nix develop`. The page loads Public Sans from
`assets/fonts/` (copied from nixpkgs), never from a CDN.

## What is real and what is staged

- The screen in the frame is a crop of a real render of Pico's Game Detail
  part on the RG353M, from `/tmp/caliper-verify/layout-1600x1000-open.png`
  (2026-09-27). It is 279 px wide, which is 72 mm at 3.875 px/mm.
- The other four states in the grid, the three takes and the compare frame are
  the same screen re-tinted with CSS filters.
- The knobs are real Pico declarations: `--pico-pixel-rows`, `--pico-pixel-min`,
  `--pico-bg`, `--pico-accent` (registered), the two `@container` thresholds in
  `PicoGameFacts.css:27` and `PicoLaunchStage.css:118`, and the plain roles.
  The skipped outputs (`--pico-px`, `--pico-cycle`) are the ones decision 26
  skips. The literal (`gap: 6px`) is invented.
- The code diff is invented but shaped like Pico's CSS. The check names,
  statuses and notes match `src/client/checks-panel.js`. The error text
  matches the shape `src/client/frame.js` produces.
- On the phone, the single-frame states show the ODIN 2 PORTAL, which cannot
  fit at true size, so the caption carries the scaled warning decision 8
  requires. Grid, compare and error show the RG353M at true size.

## Rules the direction keeps

- Decision 6 and 8: one frame at true size; a scaled frame says so; a part
  that throws shows its error in the frame and in readable copy.
- Decision 10: plain HTML and CSS. `b.css` could become the chrome's CSS.
- Decision 22: layout is a function of the container. One `@container`
  rule at 44 rem reflows every state to the phone form. Every control stays
  reachable: Parts, Preview, Takes, Code, Knobs, Checks and Calibrate are one
  tap away at both sizes.
- Decision 27: Knobs share the Takes region and the rail switches them.
- `b774276`: the page does not scroll; each region scrolls inside itself.

## Costs

- Floating panels steal room width. Between the two panels the desk has about
  860 px of free room at 1600 wide, so the grid wraps to two columns of
  RG353M frames and the ODIN 2 PORTAL (604 px) fits with little margin. A
  narrower desk needs the panels to dock, which is a third layout form
  `planLayout` does not have today.
- Amber is not one colour: `#F5A93D` on dark, `#C7740A` on light. Both pass
  contrast against their cards; the swap is a rule the chrome must carry.
- The rail hides tool names. It relies on icons plus tooltips, and on the
  phone the dock shows the names, so the desk is the only place a name is
  missing.
- The sheet on the phone takes 40 % of the height by default and 52 % for the
  first-run copy. The frame above it scrolls, which is allowed, but the
  scaled ODIN 2 PORTAL warning is the first thing to go under the sheet on a
  short phone.
