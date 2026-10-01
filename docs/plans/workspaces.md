# Workspaces: a plan

Status: approved on 2026-10-01 and recorded as [decision 45](../decisions.md#45-workspaces-ideas-that-start-from-a-question). Slice 1 is in progress. The user chose parts of it one at a time. They are listed under [Settled](#settled).

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

## Terms

| Term | Meaning |
|---|---|
| Workspace | A scratch area for one question. Nothing in it is part of the product until you promote it. |
| Idea | One answer to the question. It is a take that belongs to a workspace, not to a part. |
| Row | One thing that a column renders. |
| State row | A row that points to a declared product state. |
| Scratch row | A row file that lives in the workspace folder. Discovery never lists it as a part. |
| Shared row | A row that the workspace owns. Every column renders it. |
| Idea row | A row that one idea owns. Only the column of that idea renders it. Every idea row is a scratch row. |
| Board | The grid of rows against columns. The first column is Today: the real files with no take. |
| Cell | One row in one column, on one device. |
| Promote | Send the files of one idea through Replace or the reviewed alternate gate. |

## The workflow

1. **Open.** You write a question in a new workspace. Caliper records it with the status Open.
2. **Frame.** You pin shared rows. In slice 1, a shared row is a declared state, for example Pico Home. From slice 2, the workspace agent can also write scratch rows.
3. **Fill.** The planner turns the question into one direction for each idea. Each idea agent works in its own take. It can edit real files and add new files. From slice 3, it can also add idea rows.
4. **Compare.** The board renders every shared row in Today and in each idea column. An idea row renders only in the column of its idea.
5. **Ask.** You and the agents add open questions. You answer each one with a reason. The answers stay with the workspace.
6. **Close.** Discard deletes the ideas and the scratch rows. It keeps the questions and the answers. Promote sends a chosen idea through an existing gate. You can promote more than one idea.

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

Inferred, not tested:

- The overlay's `isProjectSource` excludes only `.caliper/takes`. It therefore treats a scratch row as project source and tags its imports.
- A scratch row that imports a file that only an idea adds resolves through `addedModule`.
- The Vite watcher ignores only `.caliper/checks/**` (`src/plugin.js`). An edit to a row therefore reaches HMR.

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
| Workspace agent, from slice 2 | The question and the names of all parts | Shared scratch rows only |

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
| 2. Scratch rows and checks | Shared scratch rows, the workspace agent, and authored-check results in cells | A row can carry input, for example the Pico rule-6 path |
| 3. Idea rows | Idea rows and the narrow idea fence | An idea can show what only it makes |
| 4. Promote | Promote for each idea through Replace or the alternate gate, and a flag when an earlier promote touched the same files | The path to production |

Slice 4 reuses `src/takes/chains.js`. It flags a take when a later accept touched the same part or the same files. It reads `part` today, so it needs the `Idea` subject.

## Pico, as an example

Question: "A person can open Settings using only the d-pad, A and B. Does Find also get a focusable entry?"

In slice 1, you pin Home and the hint bar states as shared rows. The planner makes three ideas, for example a Settings entry in the hint bar, a Settings item in the mode cycle, and a strange direction. You record the answer "Find gets an entry" with the reason "rule 6".

In slice 2, a shared scratch row renders Home with a check. The check presses the keys that the Pico surface maps to the d-pad, A and B. It passes when Settings opens and B returns to Home. Each idea column shows a pass or a fail.

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

1. Who writes shared scratch rows: a workspace agent, the planner, or only you? This plan assumes a workspace agent.
2. How do answers leave the machine: a "Copy as Markdown" action, or a file that the workspace writes into the repo when it closes?
3. Does the board need two devices at once, or is one device with a chooser enough?

## Next step

Build slice 1 test first, in this order: storage and endpoints, then the planner and idea agents, then the board, then the guide and a real run on Pico.
