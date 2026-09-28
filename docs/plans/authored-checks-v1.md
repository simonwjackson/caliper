# Authored checks v1: approved contract and implementation plan

Status: approved and implemented. Verification details follow the plan below. The plan follows the [modular/full-runtime comparison](../research/vitest-browser-mode.md). It does not reopen the browser-input decision or change ordinary Replace.

## Deliverable

A product author attaches named checks to an existing state. Caliper runs them through the consumer's current Vite server in fresh Chromium contexts. The existing Checks window, `caliper-render --check`, and the agent's `render` tool with `checks: true` report the same results.

The first release includes discovery, types, dependency delivery, input, lifecycle, evidence, cancellation, and all three reporting paths. Implementation proceeds in small working slices. A CLI-only intermediate slice is not the completed feature.

Costs: each check adds a render and browser work. Caliper owns input transport, focus checks, deadlines, cleanup, and source invalidation. Coverage remains limited to declared scenarios and checks.

## Public authoring contract

Add one optional lowercase literal `checks` export to the existing part file. Its outer keys are state export names. `default` means the default export. Inner keys are stable, nonblank check names.

```tsx
import type { StateChecks } from "@simonwjackson/caliper/checks"

// This part already exports a named Error state. Its components stay unchanged.
export const checks = {
  Error: {
    "retry loads the library": async ({ canvas, input, expect, waitFor }) => {
      await input.click(canvas.getByRole("button", { name: "Try again" }))
      await waitFor(() => {
        expect(canvas.getByRole("heading", { name: "Library" })).toBeVisible()
      })
    },
  },
} satisfies StateChecks
```

This is the supported v1 syntax. A check returns normally on success and throws or rejects on failure. A successful return does not prove the author wrote a useful assertion.

| Context member | Contract |
|---|---|
| `canvas` | Testing Library queries scoped to `#caliper-host`. Caliper's own warning/error markup is outside this default scope. |
| `within` | The standard Testing Library scope helper. Use it with a product portal root when content renders outside `#caliper-host`. |
| `input.click(element)` | Playwright-backed click with actionability checks. A covered or disabled target does not count as clicked. |
| `input.type(element, text)` | Focus and type into that element. Reject unintended focus changes rather than silently typing elsewhere or replaying a partial action. |
| `input.press(element, key)` | Send one Playwright key expression to that element. No product command dispatch or arbitrary driver API. |
| `expect` | Typed standalone Vitest assertion plugins with jest-dom. Assertions are synchronous; no implication of Vitest runner features such as snapshots or `expect.poll`. |
| `waitFor` | Testing Library's retry helper. Re-query elements inside the callback. It does not extend the runner's overall deadline. |

Only type imports are needed in a simple part. Caliper supplies runtime helpers when it executes a check. Authors can call browser-safe helper modules from a callback, including lazy imports. Take tags must follow those imports.

The input API accepts DOM elements, not a new Caliper locator language. A saved element can become stale after a re-render. V1 rejects detached elements and does not replay actions automatically. Authors re-query immediately before the next action. This limitation is explicit and must appear in the authoring docs.

Input can target product elements elsewhere in the same frame body, including portals. This deliberately extends the spike's host-only input guard without widening the default `canvas` queries. Test it with a real React portal. Reject nodes from another document or child iframe, detached nodes, and Caliper-owned diagnostic controls. These are targeting guards, not a security sandbox.

### Static discovery and types

- Read the object structure and source locations without executing any JavaScript. Accept direct function expressions, arrow functions, and methods as check values, with `as const` and `satisfies` wrappers.
- Reject computed keys, spreads, getters, duplicate names, unknown state names, imported maps, and nonfunction values with file/line diagnostics. Reusable behavior remains possible inside an inline callback.
- Validate discovery against the selected take, including take-only states and parts. The browser must confirm that the loaded callback matches the requested discovered state/name.
- `StateChecks` contextually types callbacks and assertion/input calls. Static discovery validates state names against real component exports. V1 does not require authors to maintain a second list of states for TypeScript.
- Missing or empty check declarations produce explicit `NotRun` coverage, not an interaction pass. Invalid declarations produce a failed declaration result, not a silently empty list.

## Runtime ownership and delivery

Keep product and check code in the product browser document. Caliper-owned Node code receives only validated input requests. It never imports part files through SSR or executes take-owned Node modules.

Reuse `playwright-core`. Add pinned `@testing-library/dom`, `@vitest/expect`, `@testing-library/jest-dom`, and compatible Chai/type support. Do not add the full Vitest or Jest runner or synthetic user-event input.

Expose the public types at the package boundary. Serve the trusted browser helper entry lazily through the Caliper plugin. Resolve helper dependencies from Caliper's installation, not by assuming the consumer installed them directly. Keep them out of ordinary preview requests. Linked and packed-package consumers must both pass this test before the runtime is considered usable.

No new product dev server, test config file, or manifest is required. The CLI still reads a running server. The normal visible preview is not the automated test session.

## Execution and failure contract

1. Discover selected part/state/device/take/check identities and capture source revision evidence through the server.
2. Collect the existing initial-state visual evidence separately. Interaction frames do not replace or approve those images. The authored runner does not fast-forward product animations as the screenshot renderer currently does.
3. Open a fresh context per named check, with the existing device viewport and a device scale factor of 1. Start with serial authored checks; add concurrency only after isolation evidence justifies it.
4. Load the actual frame route and wait for its non-Loading verdict. A failed frame blocks the check. Empty content can be a valid starting state; the check decides what to await next.
5. Install a run-scoped bridge and invoke the requested browser callback with the trusted helpers. Confirm frame, document, origin, element attachment, and run identity for each input operation.
6. Finish with an assertion outcome, observed browser errors, elapsed time, and a bounded attempt to capture an interaction screenshot. Missing screenshot evidence is explicit and does not erase an assertion failure.
7. Dispose handles and close the context on every path. After the run, close Chromium. Source invalidation, user cancellation, CLI interruption, and Vite shutdown stop queued checks and tear down active ones.

Starting budgets are 15 seconds for browser startup, 15 seconds per check including frame load and helper imports, and up to 2 seconds per input operation. Each action is also bounded by the remaining check budget. Cleanup gets a separate 5-second budget before terminating the owned Chromium process. The implementation obtains its process identity through the public Chromium SystemInfo protocol. Real hanging/non-yielding callbacks and process-exit probes verify this path without private Playwright fields.

Apply cancellation and finite budgets to the initial render passes too. Otherwise Stop can hang before authored execution starts. Propagate caller cancellation through the UI request, CLI signals, and agent tool AbortSignal into the same runner.

A timer that merely rejects a promise is insufficient. Verification must include a started hanging callback, delayed effects, and a non-yielding browser loop. Evidence capture must not hold cleanup open. A cleanup failure stops the run; it cannot produce a successful result. These budgets are implementation defaults to tune with real measurements, not new author-facing options in v1.

Unexpected navigation invalidates the document and yields an inconclusive interaction result. A deliberate navigation-testing API is out of scope. Browser errors observed during a check fail that check even if its callback returns normally.

## Source changes and take provenance

Use one source-revision interface for UI, CLI, and agent execution. The current broad fingerprint is local to `src/checks/api.js`; extract its policy rather than copying it into each caller. Combine content fingerprints with a server-instance identity and observed source-change generation. Include the selected take. Invalidate active results on relevant source changes, including HMR and lazy check-helper edits.

The CLI must receive take-aware discovery from the server. Today `/__caliper/project.json` returns original metadata even when the CLI plans a take render. Extend that read contract rather than making the CLI read take files itself.

Preserve completed observations when sources change, but mark the run stale and stop remaining work. Do not present observations from mixed revisions as a current pass. This is invalidation, not a frozen filesystem snapshot or proof that every possible file change was observed.

Every take report identifies its take and edited files. Compare literal check declarations where possible and list added, removed, or edited declarations. If the take edits other modules, disclose that helper behavior can also differ. Do not infer unchanged check semantics from unchanged callback text. Passing take-defined expectations never claims preservation of the original contract.

## Shared results and reporting

Extend the schema-owned report contract to version 2. Keep initial-state render evidence intact and add a separate authored-check collection per state/device result. Each entry has check identity, source location, status/reason, duration, errors, and optional interaction evidence. The run also records source revision, take provenance, and termination reason.

| Observation | Authored result |
|---|---|
| Callback returns, with no observed errors and current source identity. | `Passed`. |
| Assertion, input, callback, declaration, import, or browser error occurs. | `Failed`, with its specific reason. |
| Check deadline expires. | `Failed`, with reason `Timeout`, followed by teardown. |
| Cancellation, source invalidation, unexpected navigation, or lost infrastructure prevents completion. | `Inconclusive`, with the actual reason. |
| No check is declared, or queued work never starts. | `NotRun`, with the actual reason. |

Existing product `expectations` cannot waive authored-check failures. `Accepted` remains an automatic-findings status, not an authored success. Keep v1 saved reports readable for existing baseline approval, but never reinterpret them as interaction coverage. Test old report compatibility explicitly.

Cancellation before any complete visual result requires a terminal run outcome without fabricated images. Cancellation during authored work retains the visual report and completed observations. The UI needs a distinct cancelled terminal state when no report is available. No consumer must infer success from the absence of errors or an empty result list.

| Consumer | Required behavior |
|---|---|
| Checks window | Show named authored results, reasons, progress, and source/take provenance. Provide Stop during a run. Closing the dialog does not itself cancel. |
| CLI | Include the same discovery and results in `--list` and `--check`. Preserve current `--check` exit semantics: zero means a report was written, not that all checks passed. Interrupts must not report successful completion. |
| Agent | Include the same results with `render({ checks: true })`. Respect the existing image limit and expose omitted interaction evidence through report paths. |

Use the existing expandable Checks rows and design tokens, not a second testing dashboard. The inspected [AirOps run log](https://mobbin.com/screens/6dadd86c-1a15-47ea-b654-a45132bb45d1) supports named rows, status markers, and expanded detail. The [active-execution view](https://mobbin.com/screens/cc12838f-e8a9-465b-b26a-f7393fe58f9d) keeps cancellation with execution controls. Do not adopt the workflow canvas or aggregate quota cards.

Keep controls reachable through the current container-based layout and scrolling. Verify wide, narrow-tall, wide-short, and small embedded containers. Baseline approval remains about saved initial-state images. Ordinary Replace and the reviewed-alternate gate keep their current policies; authored checks do not silently become a new gate.

## Build slices and acceptance gates

Each slice uses one real failing public-contract test before its implementation. Approved test boundaries are discovery/types, execution through the real Vite/frame route, and the public UI/CLI/agent reporting paths. Internal helper call sequences are not the test contract.

| Slice | Work | Completion evidence |
|---|---|---|
| 1. Discover and run one check | Add static metadata, public types, lazy helper delivery, and one named retry check through a real temporary consumer. Return its result through the CLI check path. | Original passes, broken take fails, changed helper follows its take, invalid declaration is visible, and normal preview requests load no test libraries. Linked and packed consumers resolve helpers without extra consumer dependencies. |
| 2. Input and lifecycle | Add typing, targeted keys, portal support, action errors, run identity, deadlines, and teardown. | Covered/disabled/stale/foreign targets fail correctly. Focus-redirection and concurrent input are rejected. Fresh contexts isolate storage. Hanging and non-yielding checks terminate without delayed effects or remaining browser processes. Cancel separately during the first and repeat visual passes; require bounded termination and a non-success terminal outcome without fabricated evidence. |
| 3. Source identity and complete reports | Add shared source revision, take-aware discovery, report v2, provenance, and separate interaction artifacts. | Source/helper edits invalidate runs for UI, CLI, and agent paths. Take-only states work. Changed expectations are disclosed. Old baseline reports still validate. Interaction screenshots cannot become initial-state baselines. |
| 4. Finish all user paths | Add UI progress/details/Stop, agent result integration, CLI help, author documentation, and package exports. | A person can run, inspect, stop, and rerun checks without a terminal. All three consumers agree on statuses. Small containers retain controls. UI Stop, CLI interruption, Vite shutdown, and agent Stop during `render({ checks: true })` all terminate browser work within the cleanup budget. Completed observations remain available. Replace and alternate acceptance regressions remain green. |

Likely code locations: `src/derive/parts.js`, a focused static check reader, `src/types.d.ts`, the plugin's runtime/discovery routes, a dedicated authored executor and browser adapter, `src/render/check-contract.js`, `src/render/checks.js`, `src/checks/`, `src/client/checks-panel.js`, `src/agent/tools.js`, `src/agent/api.js`, `src/agent/take-agents.js`, and `bin/caliper-render.mjs`. Reuse existing render/job identities without turning the screenshot renderer into the interaction runner.

## Verification and delivery

Run `bun test` and `bun run typecheck`, plus real Chromium consumer tests with `CHROMIUM`. Add strict positive/negative authoring type probes. Add `scripts/verify-authored-checks.mjs` for both built-in viewport sizes, package delivery, and the public check paths. Re-run existing frame-commit, scenarios, checks, checks-UI, expectations, and take-overlay regressions where affected.

Use a worktree for implementation. Land verified slices by rebase and fast-forward, with research spikes kept out of production. Record the approved contract in `docs/decisions.md` when implementation begins, including the costs above.

After runtime changes land, restart the linked Pico Vite consumer using its existing project configuration and verify the new plugin is served. Exercise its existing preview and check paths. If Pico has no authored checks, state that limit and use the real temporary/packed consumer for interaction verification rather than inventing Pico action behavior. If deployment is unavailable, report the blocker and the exact restart/verification command.

V1 excludes controller commands, cross-origin or nested-frame input, arbitrary Node checks, full Vitest APIs, source freezing, whole-application network sealing, changed-file consumer inference, and a new CI acceptance policy. Automated coverage starts with Chromium; the existing visible preview support policy does not change.

## Implementation evidence and adjustments

- `test/authored-execution.test.js` first failed because reports remained v1. It now exercises real retry success, assertion failures, independent fresh checks, unchanged visual evidence, and rejection of output aliases into source.
- `scripts/verify-authored-checks.mjs` covers both viewports, portal input, keyboard input, stale/foreign/concurrent/unawaited input rejection, helper overlays, invalid/no declarations, source changes, timeouts, a non-yielding callback, actual browser-process exit, external browser loss, and cancellation in each visual pass.
- `scripts/verify-authored-agent-cli.mjs` covers take-only discovery, failed checks with a written report, CLI SIGINT/SIGTERM, and real SDK Stop/close. Playwright's default signal handlers were disabled so Caliper can finish cleanup and emit cancellation JSON.
- `scripts/verify-authored-ui.mjs` drives real Run, result/image inspection, Stop, rerun, and helper-edit invalidation. It captures wide, narrow-tall, wide-short, small, and embedded-container evidence.
- `scripts/verify-authored-package.mjs` installs isolated linked and packed consumers without direct assertion dependencies. It verifies original and broken-take outcomes on both devices and that normal previews fetch no check libraries.
- `scripts/verify-authored-regressions.mjs` retains the frame-commit, composition, checks, checks-UI, expectations, reviewed-alternate, and fast-save browser gates. `scripts/verify-authored-release.mjs` runs the four authored integration gates serially.

Before landing, the full suite passed 328 tests with no failures and no skipped tests under the configured Chromium environment. TypeScript passed. All four authored release gates and all seven existing browser regression gates passed. Linked/packed verification covered eight original/broken-take outcomes and four library-free ordinary previews. UI verification used five container shapes.

The implementation rejects value wildcard re-exports because they can hide imported check declarations. Explicit named exports and type-only wildcards remain available. It also rejects output within product source except `.caliper/checks`, including aliases into source. These restrictions avoid silently losing declarations or invalidating runs through their own output.

The browser keeps Playwright's pipe transport. WebSocket connections timed out under Bun 1.3.3 in a small reproduction, and repeated Bun pipe runs also stalled. Bun callers now send validated jobs to a fixed trusted Node worker; Node callers run directly. Product/check modules remain browser-only. This adds one Node process per Bun run and requires `node` on PATH. Public Chromium SystemInfo supplies the owned process identity for forced teardown. Timeout and non-yielding process cleanup are verified; a stalled CDP ownership handshake before process identity exists is bounded in code but was not independently reproduced. Chromium on Linux is the tested runtime, not a cross-browser or physical-device claim.
