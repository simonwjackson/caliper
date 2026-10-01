# Workspaces, slice 2: high-fidelity mockup

Status: approved by the user on 2026-10-01, in decision 45 under "Slice 2". The plan is [Slice 2 in `docs/plans/workspaces.md`](../../../plans/workspaces.md#slice-2-scratch-rows-that-check).
Slice 2 adds scratch rows that a row agent writes, and the results of their
checks in every cell of the board.

Open `index.html` for every image. To render them again, or to use the mockup
live:

```sh
docs/design/mockups/workspaces-rows/shoot.mjs      # out/*.png and index.html
nix develop -c node scripts/ui/serve.mjs           # the gallery: ?fixture=workspaceRowChecked
nix develop -c node scripts/ui/verify.mjs          # hooks, actions, keyboard and the size ladder
```

## States

| Fixture | Shows |
|---|---|
| `workspaceRowNew` | You pressed New row. The bar says what the row must show and check. |
| `workspaceRowWriting` | The row agent writes the row. The row waits at the bottom of the board. Its record shows the log, with Stop. |
| `workspaceRowChecking` | The row is written. Today is checked, idea 5 is checking, and ideas 6 and 7 wait. |
| `workspaceRowChecked` | Every column is checked. Today fails both checks. The record says why, with the page at the end of each check. |
| `workspaceRowBoard` | The same board with the side panel closed. The size ladder uses it. |

## What is real and what is staged

- **Every Pico screen is a real render.** The board is Pico's real workspace 1,
  "Settings and Find Navigation", and its ideas, takes 5 to 7.
  `caliper-render` rendered each cell on the RG353M from a copy of korri in
  `/tmp`. Your Pico checkout did not change.
- **Every check result is real.** The spike in the plan ran the row's two
  checks in each column. Today fails both. Ideas 5, 6 and 7 pass both. The
  failure text and the page at the end of each check are from those runs.
- **"Same as Today" is measured.** Idea 7's Find and Settings cells are
  pixel-identical to Today's (ImageMagick `compare`, 0 pixels differ).
- **The chrome is the real chrome.** These images are the gallery rendering
  the components in `src/client/ui/board/` with fixture data. `planBoard`
  places the cells. The pieces that slice 2 adds are real components too:
  `CheckLine`, `RowRecord`, `RowCheck`, New row and the bar's two new modes.
- **Staged:** the row agent's log and reply, the file name `rows/1.part.tsx`,
  and the words in the bar. Nothing is wired to a server.

The row itself is `spike/row.part.tsx`. I wrote it by hand, as the row agent
would. It sat in a copy of Pico at `src/workspace-rows/`, because the frame
route cannot serve a file in `.caliper/` yet; its imports assume that place.
The other files in `spike/` made the results and images, in this order:
`overlay-spike.sh` and `hmr-spike.sh` (a row file in `.caliper/` loads through
the overlay and reaches HMR), `check-spike.sh` (the checks in each column),
`render-cells.sh` (the cells) and `gen-rows-fixture.mjs` (the fixture data).
They use `/tmp` and paths on this machine.

## What the mockup decides

These are the choices to approve.

1. **New row sits under the last row**, at the end of the axis it extends,
   as [AirOps](https://mobbin.com/screens/b55e31ae-5ef4-48c4-baaf-8f298d3ec3fc)
   puts Add Column. When the board shows one row at a time, New row ends the
   row picker. An empty board offers it too.
2. **A row with checks gets one line under every cell.** A sign and a count,
   "2 of 2 checks pass", in the colour of the result, never colour alone
   ([Mintlify](https://mobbin.com/screens/31bc9279-f1e6-449c-9143-583e558609b4)).
   The line can also say Checking, Waiting to check, Out of date, Not
   checked or Could not check. It costs 24 px of height, and `planBoard`
   counts it.
3. **The row's record takes the side panel**, where the questions sit, or a
   sheet on a phone. The count comes first, then each named check with its
   source line, its failure text and the page at its end, as the
   [Devin test report](https://mobbin.com/screens/9ecbe8d4-8d1c-49dd-aae2-92f4e32f2744)
   does. A chooser shows each column's tally, such as "0/2" and "2/2".
4. **A row's name, or the line under a cell, opens the record.** A scratch
   row is then focused: the bar talks to its agent and holds Stop and Delete
   row, as it does for an idea.
5. **While its agent writes, the new row waits** at the bottom, with a plate
   in every cell. The record shows the log as it grows.
6. **Discard keeps the rows.** This changes step 6 of the plan's workflow.
   The rows are the checks the answer relied on.

## How the board adapts

`planBoard(width, height, { columns, rows, line }, frame)` takes the height
of the check line. The line does not scale with a cell, so it comes off the
height before the cell does. Everything else is slice 1's rule. The ladder
images show the checked board at five sizes, and `scripts/ui/verify.mjs`
checks at eight sizes that every control is on screen or in a scroll region.

## Two findings

- **A check's own defect looks like an idea's failure.** The spike's first Find
  check matched the word "find" with word boundaries. Ideas 6 and 7 failed it,
  because their tab's text reads "FINDOPTIONS" to the page. This is why the
  record shows each check's source line next to its result.
- **An idea can change a pinned state's own fixture.** Idea 7 edited
  `PicoHome.page.part.tsx`, so its Home cell shows the drawer open. Its d-pad
  row, which composes the real surface, starts with the drawer closed. A
  scratch row belongs to the workspace, so no idea can change what it starts
  from.

## Not drawn

- A pinned state whose part has its own `checks` export. It gets the same line
  and the same record, without the brief, the log and Delete row.
- Out of date, Not checked and Could not check on the board. The `CheckLine`
  part shows each of them.
- A row whose file is gone, and the board after Delete row.
