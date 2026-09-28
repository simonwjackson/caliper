# Visual direction mockups

Three directions for Caliper's chrome, 2026-09-28. Each is one HTML page with
its own CSS, rendered at desk (1600 × 1000) and folded phone (416 × 640) in
light and dark. `index.html` is the gallery.

| Page | Direction | Type | The one bold thing |
|---|---|---|---|
| `a-bench.html` | Bench: the instrument on a workbench | IBM Plex Sans, Plex Mono for readouts | A millimetre rule along the stage, with the device's true width marked on it |
| `b-darkroom.html` | Darkroom: legacy's Photoshop promise without the glass | Public Sans | The device is the only lit thing; tools on a rail, panels float as opaque cards |
| `c-tiles.html` | Tiles: a tiling window manager | Fira Sans, JetBrains Mono for titles and readouts | Tiles with title bars, a focus border, and a workspace bar that becomes the phone's navigation |

## Run

```sh
docs/design/mockups/serve.mjs          # http://[::]:5312/, any host, all interfaces
docs/design/mockups/render.mjs         # writes out/*.png through the dev shell's Chromium
docs/design/mockups/probe.mjs a-bench 416 640   # prints each region's box, for layout debugging
```

Both scripts run through `nix develop`. The pages load fonts from
`assets/fonts/` (copied from nixpkgs: ibm-plex, public-sans, fira,
jetbrains-mono), never from a CDN.

## What is real and what is staged

- The screen in the frame is a crop of a real render of Pico's Game Detail
  part on the RG353M, from `/tmp/caliper-verify/layout-1600x1000-open.png`
  (2026-09-27). It is 279 px wide, which is 72 mm at the 3.875 px/mm the
  mockups assume.
- The three takes are staged. Their thumbnails are the same screen, tinted
  with CSS filters, to stand in for real alternates.
- The part list, state names, counts, model line and Setup line match what
  the chrome shows today for Pico.
- On the phone, A and C show the RG353M at true size (it fits in 416 px).
  B shows the ODIN 2 PORTAL, which does not fit, so the caption carries the
  scaled warning that decision 8 requires.

## Rules each direction keeps

- Decision 6 and 8: one frame at true size; a scaled frame says so.
- Decision 10: plain HTML and CSS. Each page's CSS could become chrome CSS.
- Decision 22: layout is a function of the container. Each page has one
  `@container` rule at 44 rem that reflows to the phone form. Every control
  stays reachable: Parts, Preview, Takes, Code, Knobs, Checks and Calibrate
  are all one tap away at both sizes.
- `b774276`: the page does not scroll; each region scrolls inside itself.

## Costs, per direction

| Direction | What it makes harder |
|---|---|
| Bench | The rule needs the calibrated px/mm and must redraw on calibrate and on scale. A scaled frame needs a scaled rule, or the rule must hide and say why. Light mode is the default; the dark mat is the weaker of the two. |
| Darkroom | Floating panels over the stage steal stage width; on a narrow desk the panels must dock, which is a third layout state `planLayout` does not have today. Amber on dark passes contrast; amber on light needed a much darker tone, so the accent is not one colour across schemes. |
| Tiles | The mono title bars and status bar hold readouts only, so they cost height on the phone. Zero radius and hard borders are a commitment: this direction cannot be softened later without becoming direction B. Workspace numbers assume the user will learn them. |
