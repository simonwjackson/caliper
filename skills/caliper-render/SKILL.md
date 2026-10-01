---
name: caliper-render
description: See a UI part the way a target device shows it, with caliper-render. Use after you change a component, its CSS or a *.part.tsx file in a project whose vite.config has caliper(), and before you say the change works.
---

# caliper-render

`caliper-render` renders one part of a running project at a device's CSS viewport. It prints a JSON verdict
for each state and device, and writes a PNG for each. Run `caliper-render --help` for every flag and field.

## The loop

1. Find the dev server. The project's `vite` must run with `caliper()`. Its terminal prints
   `➜  Local: http://…/`; that origin is `--url`, not the Caliper app's URL. The file for the project
   in `~/.local/state/caliper/servers/` holds the same URL as `url`. If no server runs, start the
   project's dev script in the background, and stop it when you finish.
2. Find the part: `caliper-render --url <origin> --list`. A part is a `*.part.tsx` file. Each exported
   component whose name starts with an upper-case letter is a **state**. The default export is `default`.
3. Render: `caliper-render --url <origin> --part <file> --state '*' --device '*'`.
4. Read the verdict, in this order:
   - `frame` must be `Rendered`. For `Failed`, fix the cause in `problems` (the stack names the file and
     line). For `Empty`, the component returned nothing.
   - `console` must be empty. It lists failed requests and errors that the frame did not catch.
   - `spill` is `null` when the part fits the screen. Otherwise it names the elements that reach past the
     edge. The device clips that content, or scrolls to it. Decide if that is the design (a list that
     scrolls) or a defect (a label cut off at the top).
5. Look at every PNG with your image reader. One image pixel is one CSS pixel of the device. Judge the
   result against the task, at the device's size.
6. Change the code, and go back to step 3. The dev server picks up each save.

The loop is done when every result is `Rendered`, `console` is empty, you can explain each `spill`, and
the PNGs show what the task asked for.

## Automatic reports before completion

Run the same request with `--check` before reporting completion. Add
`--baselines <project>/.caliper/baselines` to compare accepted images. Use
`--part '*' --state '*' --device '*'` when a change needs all declared states.
The in-process take agent uses `render` with `checks: true`; `related: true`
checks the subject states and declared parent scenarios, not all consumers.

Read each check's status and detail. `Failed` names a detected problem.
`Review` means inspect empty content, spill, incomplete accessibility checks,
and changed or missing baselines. `Inconclusive` and `NotRun` are not passes.
`Accepted` means observed findings match product-owned exceptions, not a clean
pass. Read `accepted` reasons and targets as well as raw evidence in `detail`.
Report exception counts even when another finding leaves the check failed.
Unused declarations appear in `unmatched` and need review. Do not add exceptions
merely to make a report pass; product intent needs an explicit reason and scope.
See docs/guide.md “Declare product intent” for the literal `expectations` contract.
With `--check`, exit 0 only means the report was written. It does not mean all
checks passed. Reports never block Replace.

Inspect both PNG sets in the saved run folder. Do not approve images merely to
remove a finding. When the user explicitly asks to approve reviewed product
images, use `--approve <report.json> --baselines <directory>`. This approves saved
evidence, never fresh unseen renders. Takes cannot become baselines; check the
real files after acceptance. Approval leaves other findings visible.

State the checked parts, states and devices, unresolved findings, and report
path. Do not claim that image matches prove interactions or all consumers safe.

## Rules

- Make a new state to show a case, for example `export const NoResults = () => <List items={[]} />` in the
  part file. A part supplies its own data. Caliper never intercepts requests.
- Exit status 2 means the request or the setup is wrong. Its `error` field names the fix.
- `--take <n>` renders the part as the take in `.caliper/takes/<n>/` changes it. Use it to check a take
  without changing the real files.
- The spill and the PNG show the part at rest. An animation that ends is jumped to its end first, so an
  entry animation that starts off the screen is not a spill. A looping animation keeps running.
- The PNG shows size and layout truthfully. Font smoothing and colour can differ a little from the device.
