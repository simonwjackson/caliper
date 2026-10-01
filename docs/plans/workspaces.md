# Workspaces: a plan

Status: approved on 2026-10-01 and recorded as [decision 45](../decisions.md#45-workspaces-ideas-that-start-from-a-question). Slice 1 is built; its choices and its real run are under Built in the decision. [Slice 2](#slice-2-scratch-rows-that-check) is planned and drawn, not approved. Slices 3 and 4 are not built. The user chose parts of it one at a time. They are listed under [Settled](#settled).

## Problem

A take starts from one part and one of its declared states. Some prompts start from a question instead. An example from Pico: "A person can open Settings using only the d-pad, A and B."

The answer to a question like this can reuse existing parts, change them, add new parts, or do all three. You and the agent decide that for each prompt. Some answers end as a decision with no code. Some answers end close to production. Caliper has no place for this work today.

Verified in the code:

- `TakeRecord` requires `part`, `state` and `device` (`src/takes/store.js`).
- `planDirections` requires `part` and `state` (`src/agent/planner.js`).
- The stage shows the takes of one selected state.

## Settled

| Date | Choice | Rejected, and why |
|---|---|---|
| 2026-10-01 | One workspace holds several competing ideas. Each idea is its own take with its own overlay. | One idea per workspace. A comparison of ideas would then need a second feature that compares across workspaces. |
| 2026-10-01 | The workspace owns shared rows. An idea can add its own rows. | Shared rows only: an idea cannot show what only it makes. Idea rows only: there is no grid, so there is no clean comparison. |
| 2026-10-01 | Slice 1 as written: state rows only, judged by looking. | Scratch rows and checks in slice 1: a bigger first slice that needs the workspace agent or rows written by hand. |
| 2026-10-01 | The mockup in `docs/design/mockups/workspaces/` and its six choices, approved with "no notes". | |
| 2026-10-01 | A row agent writes the shared scratch rows (slice 2). You say what the row must show and check. The agent writes only that row's file, renders it in Today and runs its checks there. | The planner writes rows with the plan: one model call that cannot render or run a check, so a broken row reaches every idea. Only you write rows: no new agent, but the slowest path, and the code pane cannot write into `.caliper/`. |

## Terms

| Term | Meaning |
|---|---|
| Workspace | A scratch area for one question. Nothing in it is part of the product until you promote it. |
| Idea | One answer to the question. It is a take that belongs to a workspace, not to a part. |
| Row | One thing that a column renders. |
| State row | A row that points to a declared product state. |
| Scratch row | A row file that lives in the workspace folder. Discovery never lists it as a part. |
| Shared row | A row that the workspace owns. Every column renders it. |
| Row agent | The agent that writes one scratch row, from slice 2. |
| Idea row | A row that one idea owns. Only the column of that idea renders it. Every idea row is a scratch row. |
| Board | The grid of rows against columns. The first column is Today: the real files with no take. |
| Cell | One row in one column, on one device. |
| Promote | Send the files of one idea through Replace or the reviewed alternate gate. |

## The workflow

1. **Open.** You write a question in a new workspace. Caliper records it with the status Open.
2. **Frame.** You pin shared rows. In slice 1, a shared row is a declared state, for example Pico Home. From slice 2, a row agent can also write a scratch row from what you ask, with checks that press keys.
3. **Fill.** The planner turns the question into one direction for each idea. Each idea agent works in its own take. It can edit real files and add new files. From slice 3, it can also add idea rows.
4. **Compare.** The board renders every shared row in Today and in each idea column. An idea row renders only in the column of its idea.
5. **Ask.** You and the agents add open questions. You answer each one with a reason. The answers stay with the workspace.
6. **Close.** Discard deletes the ideas. It keeps the rows, the questions and the answers. (Changed in slice 2: the scratch rows stay, because they are the checks the answer relied on.) Promote sends a chosen idea through an existing gate. You can promote more than one idea.

## Model

The workspace record is `.caliper/workspaces/<id>/workspace.json`:

```ts
type Workspace = {
  id: string
  question: string
  created: number
  status:
    | { _tag: "Open" }
    | { _tag: "Closed", at: number, promoted: TakeIdentity[] } // empty: discarded only
  rows: Row[] // shared rows, in board order
  ideas: TakeIdentity[]
  questions: Question[]
}

type Row =
  | { _tag: "State", part: string, state: string }
  | { _tag: "Scratch", file: string } // relative to the workspace folder

type Question =
  | { _tag: "Open", id: string, text: string, by: "User" | TakeIdentity }
  | { _tag: "Answered", id: string, text: string, answer: string, reason: string, at: number }
```

An idea is a take. The take record gets a subject union:

```ts
type Subject =
  | { _tag: "State", part: string, state: string, device: string, context?: StateRef }
  | { _tag: "Idea", workspace: string }
```

Caliper reads every record that exists today as a `State` subject. Six files under `src/` name the `TakeRecord` type. The chrome has its own `TakeRecordView` type in `src/client/ui/contract.ts`. Each of them must handle the `Idea` case. The Takes panel must not list an idea under a state.

Idea rows live in `.caliper/workspaces/<id>/ideas/<take>/`. That folder is outside `.caliper/takes/<n>/`, so Replace never copies an idea row into the project.

A scratch row uses the part file format: a default export, named state exports, and an optional `checks` export. Inferred, to be tested in slice 2: the renderer and the authored-check discovery can then read a scratch row with no change.

## How a cell renders

A cell loads its row with `?take=<n>` in an idea column, and with no tag in Today.

Verified in `src/takes/overlay.js`: `resolveId` copies the tag of the importer to each import, and `load` serves the take's copy of a file when one exists. So a row that imports `src/Home.tsx` gets the copy of `Home.tsx` from idea 2 in the column of idea 2.

Checked on 2026-10-01 on a copy of Pico with Vite 8.3.1. The row file was `.caliper/workspaces/1/rows/home-dpad.part.tsx`, and Pico's take 1 edits `src/pages/PicoHome.tsx`:

- Vite serves the row file. With `?take=1`, its imports carry `?take=1`, both `/src/...` and relative ones, and Vite serves take 1's copy of `PicoHome.tsx`. So the overlay treats a scratch row as project source.
- An edit to the row file reaches HMR. Vite sent an update for the row with the tag and without it.
- Discovery does not list the row. `project.json` has no part under `.caliper/`.
- The frame route refuses the row with 404. It serves only discovered parts and the parts of a take. Slice 2 must change this.

Inferred, not tested: a scratch row that imports a file that only an idea adds resolves through `addedModule`.

A cell shows one of three things:

- the frame verdict: Rendered, Empty or Failed
- "Only in <idea>", for the row of another idea
- the authored-check results, from slice 2

A shared row that fails in one idea column is a finding. That idea broke something the row uses.

## Keep the workspace out of the product

This section is how the plan holds to [decision 18](../decisions.md#18-product-owned-working-scenarios).

- Discovery never lists a scratch row. Verified in `src/derive/parts.js`: Git lists parts with `--exclude-standard`, and `.caliper/` ignores itself. Without Git, the walk skips dot-folders.
- A scratch row is not a declared page state. A check report names it as a workspace row. It adds no coverage. Its images cannot become baselines. Take images cannot become baselines today either.
- Today the take fence rejects all of `.caliper/` (`fenceProjectPath` and `HIDDEN_FOLDERS` in `src/takes/store.js`). An idea agent gets one narrow extra fence: its own `ideas/<take>/` folder. It can read shared rows, but it cannot write them. An idea that can edit a shared row can change the test to fit its answer.
- Promote uses only the existing gates. Replace validates the proposed part declarations before it copies files. The reviewed alternate gate requires a product-owned preview state, render checks and your confirmation.
- A scratch row never goes into the product. If a row must become a product state, the agent writes it again as a state in a real part file during promote.

## Agents

| Agent | Reads | Writes |
|---|---|---|
| Planner | The question, the sources and Today renders of the shared rows, and the names of all parts | Directions only |
| Idea agent | Its direction, the titles of the other directions, and the shared rows | Its take. From slice 3, also its own idea rows |
| Row agent, from slice 2 | The question, the real files, the names of all parts and the other rows | Its own scratch row file only |

The planner keeps decision 33. With three or more ideas, one direction is the strange direction.

## The board

I looked at six Mobbin screens. Three of them changed this plan:

- [MagicPath](https://mobbin.com/screens/6587376c-0460-458c-8096-75258e1ce905) labels each frame on its canvas with the agent that makes it. It keeps the plan in a panel beside the canvas. The board adopts both. Each column header names the idea and the status of its agent. The questions sit in a side panel.
- [Magnific](https://mobbin.com/screens/1ad1c0df-c3d6-4e6f-93a2-226ad9411ca3) keeps a "Final result" area apart from the options. The answers list does the same. Answers sit apart from the ideas that informed them.
- [Tana](https://mobbin.com/screens/5a890b9d-2b9d-4714-9c03-e7495eac50f5) and [Higgsfield](https://mobbin.com/screens/db7d1413-a8ec-4a80-9176-d9b695e03396) use a free canvas. The board rejects it. Free placement loses the row alignment that a comparison needs, and pan and zoom are hard on a phone.

A high-fidelity mockup of slice 1 is in [`docs/design/mockups/workspaces/`](../design/mockups/workspaces/README.md). Its `planBoard` replaces the table below with tested thresholds.

The layout is one pure function, `planBoard(width, height, { columns, rows })`. It follows the same pattern as `planChecks`. It uses the existing Caliper tokens. Every threshold is a guess until someone measures it in the real container.

| Container | Structure | What moves |
|---|---|---|
| Wide and tall | The full grid. Row labels and column headers stay in view. Rows scroll. | Nothing |
| Wide and short | One row at a time, with all columns side by side | Rows go into a row picker |
| Narrow and tall | One column at a time, with the rows stacked. Today and one idea show as a pair when two columns fit. | Columns go into a column picker |
| Too small for two columns at the minimum cell scale | One cell | Rows and columns both go into pickers |

Each picker uses real labels. Every cell stays reachable. No cell is dropped at any size.

Frame count: rows × (ideas + 1), on one device. Four rows and three ideas make 16 frames. The board renders one device at a time, with the existing device chooser. The board loads only the cells in view.

## Slices

Each slice works end to end.

| Slice | Delivers | Proves |
|---|---|---|
| 1. Answer only | The workspace record, the question, state rows, the planner and ideas, the board on one device, questions and answers, and discard | The path from a question to an answer, with no new row format and no new fence |
| 2. Scratch rows and checks | Shared scratch rows, the row agent, and authored-check results in cells | A row can carry input, for example the Pico rule-6 path |
| 3. Idea rows | Idea rows and the narrow idea fence | An idea can show what only it makes |
| 4. Promote | Promote for each idea through Replace or the alternate gate, and a flag when an earlier promote touched the same files | The path to production |

Slice 4 reuses `src/takes/chains.js`. It flags a take when a later accept touched the same part or the same files. It reads `part` today, so it needs the `Idea` subject.

## Pico, as an example

Question: "A person can open Settings using only the d-pad, A and B. Does Find also get a focusable entry?"

In slice 1, you pin Home and the hint bar states as shared rows. The planner makes three ideas, for example a Settings entry in the hint bar, a Settings item in the mode cycle, and a strange direction. You record the answer "Find gets an entry" with the reason "rule 6".

In slice 2, a shared scratch row renders Home with a check. The check presses the keys that the Pico surface maps to the d-pad, A and B. It passes when Settings opens and B returns to Home. Each idea column shows a pass or a fail. The spike under [Slice 2](#slice-2-scratch-rows-that-check) ran this check for real.

Limits for this example:

- A browser key press is not gamepad input. The guide states that checks do not prove controller or native-device input.
- The host bug is outside the workspace. The host never sends the system input to a surface. An idea agent cannot run commands, so a workspace cannot test a host change.

## Costs and limits

- **A new stored shape.** Six files name the `TakeRecord` type, and the chrome has `TakeRecordView`. Each one needs the `Idea` case.
- **A new fence.** The idea fence opens a hole in the rule that takes never touch `.caliper/`. It must stay narrow, and tests must cover it.
- **Frames.** Four rows and three ideas make 16 frames on one device.
- **Answers stay on one machine.** Git ignores `.caliper/`. If other people need an answer, someone must copy it into a document in the repo.
- **Shared edits.** A promoted idea still changes every consumer of the files it edits. Decision 18 still applies.
- **Screenshots are not behaviour.** A board shows renders. Checks prove only what they assert, and only in Chromium.
- **Conflicts.** Two promoted ideas that edit the same file conflict. The flag shows the conflict. Caliper does not merge the two.

## Open questions

1. Answered on 2026-10-01: a row agent writes shared scratch rows. See [Settled](#settled).
2. How do answers leave the machine: a "Copy as Markdown" action, or a file that the workspace writes into the repo when it closes?
3. Does the board need two devices at once, or is one device with a chooser enough?

## Slice 2: scratch rows that check

Status: draft, not approved. The mockup is in [`docs/design/mockups/workspaces-rows/`](../design/mockups/workspaces-rows/README.md).

### What you do

1. On the board, press **New row** under the last row. The bar asks what the row must show and check.
2. Write it, for example: "Home on the portal's own input. Check that the d-pad and A open Settings, and that B returns to Home." Press **Write row**.
3. The row agent writes one row file. It renders the row in Today and runs the row's checks there. While it works, the new row waits at the bottom of the board.
4. Every column renders the row. Under each cell, one line says how the row's checks went in that column: "2 of 2 checks pass", "0 of 2 checks pass", "Checking", "Out of date" or "Not checked".
5. Press the row's name, or the line under a cell, to open the row's record in the side panel. It holds what you asked, the file, each check in each column with its failure text, the image at the end of a check, and the agent's log. While the row is focused, the bar sends your prompt to the row agent, and has Stop and Delete row. The record has **Check again**.

### Model

- `Row` gains `{ _tag: "Scratch", file, brief }`. `file` is `rows/<n>.part.tsx` in the workspace folder. Caliper names the file when the row agent starts, so the record names the row before the file exists. `brief` is what you asked.
- A scratch row is one state: its default export. Its checks are under `default`. The board shows no other export of the file.
- The workspace record keeps the order of all rows. A scratch row whose file is gone says so in its cells, as a missing state does.
- The row agent's conversation and log live in the app's memory, as a take's do. The file and the brief are on disk.

### The row agent

| Reads | Writes | Runs |
|---|---|---|
| The question, the real files, the names of all parts, the other rows | Its own row file only | The row in Today, with its checks |

- It cannot read an idea's files. It cannot write a product file, another row or an idea. It stops after 40 turns, as a take does.
- Its prompt says that a check that fails in Today can be the finding. It must not weaken a check so that Today passes. It reports what Today does.
- You can edit a row file in your own editor. Vite reloads its cells, and their results go out of date.

### Checks in cells

- Caliper runs checks one column at a time: every row of that column that declares checks, in one run. Only the authored checks run. There is no second render and no accessibility audit. Each named check runs in a fresh Chromium context, as "Authored checks: browser input" in the decisions says.
- Runs start by themselves. When a row agent stops, its row runs in every column whose agent is idle. When an idea's agent stops, that idea's column runs. **Check again** runs one row in every column. A project runs one check run at a time.
- A result keeps the source revision it ran on. When the row file, the idea's files or the project's files change, the cell says "Out of date" until the next run. Results live in the app's memory. After a restart, the cells say "Not checked".
- A pinned state whose part has a `checks` export gets results in its cells too.

### Ideas and the planner

- The planner gets the source of every row and Today's check results.
- An idea's first message lists the rows, their sources and Today's results. Its `render` tool with `rows: true, checks: true` runs the rows' checks in the idea. A row added after an idea starts reaches it with its next prompt.
- An idea still cannot write a row.

### Changes inside Caliper

- The frame route serves `.caliper/workspaces/<id>/rows/<n>.part.tsx`. It accepts only that pattern, and no link in the path.
- `check-source` and the source revision include workspace rows. An edit to a row during a run makes the run stale.
- The plugin can write, read and delete one row file, behind the host target `workspaces`. This raises the protocol to 5.
- `planBoard` counts a line under each cell when any row has checks.
- Discard keeps the row files. This changes step 6 of the workflow. The rows are the checks the answer relied on, and a closed board still shows them in Today. Cost: the files stay in `.caliper/` until you delete them.

### Spike

Run on 2026-10-01 on a copy of korri in `/tmp`, with Pico's workspace 1 and its ideas, takes 5 to 7. Verified:

- A row file can compose the real `PicoSurface` with the portal's own input: its input bus, keyboard adapter and spatial focus, imported from `clients/portal/src/input`. Vite served those modules from outside Pico's root. The arrow keys move focus as the d-pad does on the device, Enter is A, and Escape is B.
- The row has two checks that press only those keys: "the d-pad and A open Settings, and B returns to Home", and "the d-pad and A open Find". In Today, both fail: no control named Settings or Find is reachable. In ideas 5, 6 and 7, both pass. One check took 0.6 to 4.4 s.
- The first version of the Find check matched `\bfind\b`. Ideas 6 and 7 failed it, because their tab's text reads "FINDOPTIONS" to the page. A defect in a check looks like a failure of an idea. You must read a row before you trust its results, so the row's record shows each check's source line and failure text.

### Shipped products

- The [Devin test report](https://mobbin.com/screens/9ecbe8d4-8d1c-49dd-aae2-92f4e32f2744) puts the count first, then each named test with one line of evidence. The row's record does the same.
- [Mintlify's previews](https://mobbin.com/screens/31bc9279-f1e6-449c-9143-583e558609b4) mark a status with a sign and a word, not colour alone. The line under a cell does the same.
- [AirOps](https://mobbin.com/screens/b55e31ae-5ef4-48c4-baaf-8f298d3ec3fc) puts Add Column at the end of the axis it extends. New row sits under the last row.
- [Browserbase](https://mobbin.com/screens/073d8baf-023d-40ef-8d91-98c05d12354a) lists an agent's run as steps beside the result. The row's record reuses the take log for this.

### Costs and limits

- A third kind of agent, and its model calls for each row.
- Check runs take time. On Pico, two checks in four columns are eight browser contexts, about 20 s for a full pass, one run at a time.
- Results do not survive a restart.
- A defect in a check looks like a failure of an idea (see the spike).
- A row that imports code from outside the Vite root depends on Vite serving a module that an allowed module imports. Inferred from the spike; Vite does not document it.
- A browser key press is not gamepad input. The Pico row proves the portal's keyboard path and the surface. It does not prove the gamepad adapter, the native input adapter or the host's system input.
- A scratch row is not a product state. It adds no coverage, and its images never become baselines (decision 18).

### Build order

Test first, in a worktree. Land each step on `main` and deploy it.

1. Storage and fence: scratch rows in the record, the row file's write, read and delete, the frame route, the check source and the source revision.
2. The row agent: its tools, prompt and log, and its routes.
3. Checks in cells: the runner, results in the snapshot, the triggers. Ideas and the planner see the rows.
4. The board: New row, the scratch row's name, the line under a cell, the row's record and the bar. Gallery and size ladder.
5. The guide, the changelog, decision 45, and a real run on Pico.

## Next step

The user reviews the slice 2 mockup. After approval, build slice 2 in the order above.
