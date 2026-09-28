# Full Vitest Browser Mode versus modular checks

## Result

Full Vitest Browser Mode 4.1.10 can query and drive an actual Caliper frame through its public nested-frame locator API. It supplies retrying DOM assertions and Playwright input without Caliper's custom input bridge. State-local checks and take-tagged helpers worked when the check ran in Vitest's tester document and targeted the nested product frame.

It is not a drop-in runner for Caliper's existing frames. The tested stock runtime created two Vite server instances, disabled HMR and watching, and served the product through its own browser server. Product-frame lazy check execution failed on a Vitest-injected dynamic-import wrapper. Moving execution to the tester document resolved that failure but changed the check's JavaScript realm.

My recommendation is to retain the modular proposal under Caliper's current server model. Full Vitest becomes attractive if a separate testing runtime and a tester-document check contract are acceptable. That is an architectural choice, not an assertion-package swap. Neither option eliminates Caliper's isolation, take identity, reporting, or cleanup responsibilities. This experiment does not select the production architecture.

## What ran

The spike used the previous local React Library scenario through the real Caliper plugin and `/__caliper/frame` route. Retry changes state asynchronously; search accepts typing and Enter. A covered button verifies hit-testing. One take breaks retry; another changes both the heading and a transitive check helper. A React key change replaces the retry button during the action, without changing its appearance.

Both candidates used Chromium 149.0.7827.200, Playwright 1.59.1 and Vite 6.4.2 at 640 × 480 and 1920 × 1080 CSS pixels. These are viewport sizes, not physical-device tests. The fixture reads `document` at module load. No product or check module ran in Node.

| Run | Observed outcomes |
|---|---|
| Full runtime, default API settings | 28 outcomes matched predictions. Two hanging checks failed at the test deadline. The other probes include assertions that expected operations fail. |
| Full runtime, API writes disabled | The same 28 predictions held. Both real-file write attempts were refused. |
| Cancellation | Four tests reported skipped with an interrupted run. Both already-started test functions continued and sent an observation after cancellation. |
| Modular stack | 22 outcomes matched predictions: 14 successful checks and eight expected failures. Fresh contexts and an experiment-owned deadline/close operation isolated runs. |

All four runs closed their observed browser connections and HTTP servers. Raw reports retain expected failures rather than converting them into product passes. `verify.mjs` checks the reports and exits successfully only when the experiment's predictions hold. These 82 outcomes are not 82 passing product checks.

## Comparison

| Concern | Full Browser Mode | Modular proposal |
|---|---|---|
| Real browser input | Public `page.frameLocator(...)` and the Playwright provider sent trusted clicks, refused covered clicks, and handled typing and Enter. | The bounded bridge produced the same results for the tested actions. Caliper owns the transport and its guards. |
| Assertions | `expect.element` supplied retries, visibility, focus and accessible-name assertions. | Standalone Vitest assertion plugins plus jest-dom worked. Testing Library `waitFor` supplied retries. |
| Replaced elements | A saved locator re-resolved the replaced retry button and clicked again. | The saved DOM element became detached. The bridge rejected it. Re-query/retry policy remains Caliper work. |
| State and take authoring | Same-file check exports and transitive take helpers worked from the tester document. The helper's `document` was not the product document. | Checks and helpers executed inside the product frame, including changed take expectations. |
| Direct product-frame check execution | The lazy helper failed because the transformed import expected `__vitest_mocker__.wrapDynamicImport`. No fake runtime globals were supplied. | Native dynamic imports worked without runner globals. |
| Browser state | Replacing the product iframe between tests retained local storage. Stock test isolation was not a fresh context per check. | Each check got a new Playwright context. Consecutive storage probes began empty. |
| Test timeout | Vitest reported the hanging check as failed. Its delayed JavaScript still wrote storage visible to the next test. | The experiment confirmed that the hanging function started, applied a deadline, and closed its context. A delayed driver notification did not arrive during the observation window. This is Caliper-owned work, not assertion-library behavior. |
| Run cancellation | Vitest returned an interrupted run and skipped results. Already-started browser code continued afterward. Final `close()` disconnected the browsers. | Not tested through a cancellation API. The experiment tested deadline-triggered context closure only. |
| Browser commands | Default file commands wrote a disposable real project file, outside the take overlay. Setting both API `allowWrite` options false refused the write probe. | The experiment exposed only bounded input operations, not filesystem commands. This still is not a browser security sandbox. |
| Server integration | `createVitest` plus the stock provider created a parent server and a browser server. Both used `hmr: false`, `watch: null` in this non-watch experiment. | One ordinary Vite server served Caliper and the take overlays. No runner plugin changed its configuration. |
| Reporting | Public reporters returned named test results, errors and interruption state. Caliper must map them to part/state/device/take evidence. | Caliper must implement the result lifecycle and mapping. Neither experiment shipped chrome, CLI or agent integration. |

These are different lifecycle policies, not equal isolation settings. Full Vitest used its stock context lifetime and removed the product iframe after each test. The modular adapter deliberately created and closed a context per check. Adding equivalent teardown to full Vitest remains an integration option. The timeout code also ran in different realms: tester document for full Vitest, product document for modular checks.

The modular probe used the same dependency installation as the full runner to hold versions steady. It imported standalone `@vitest/expect`, not the Vitest runner. This is not a dependency-size comparison.

## Integration costs that remain

The public `VitestPlugin` can initialize Vitest when a host creates its Vite server. It is not a late-attach API for a running server. Its configuration changes include disabling HMR; the stock browser provider still starts another server. A custom provider/server factory is an extension option, but it would make Caliper own more runtime integration. Neither custom integration nor a proxy to the original preview server was tested.

The full-runtime experiment loaded Caliper from the consumer's Vite config so both server instances installed it. Passing Caliper only as a `createVitest` configuration override did not carry it to the browser server. This is another reason not to treat a standalone Vitest demo as proof of compatibility with the running preview server.

The runtime owns useful mechanisms but not Caliper's product rules. Fresh check state, hard cleanup, take identity, changed-expectation reporting, run invalidation, and preservation of initial-state visual evidence still need a contract. Browser-side execution also does not imply limited authority: Vitest's command API and Caliper's same-origin routes need separate review. Disabling file writes is one guard, not a complete security proof.

Both candidates passed when a take changed the implementation and its expected heading. That demonstrates take-aware loading. It does not prove that the original expectation still holds.

## Limits

This is a throwaway integration experiment, not a shipped authored-check API. No performance or package-size comparison was made. Do not infer that either option is faster or cheaper to maintain from these counts.

No Firefox, WebKit, physical-device, live Pico, whole-consumer typecheck, concurrent-take isolation, focus-redirection, or infinite-loop test ran. Source edits, HMR behavior, and watch-mode cancellation were not exercised. Server settings were observed directly, but that is not an HMR regression test. Storage sharing was measured between tests in one file; reuse across files was inspected in source, not measured.

The nested-frame checks were same-origin. A separate testing origin would need a different integration for browser-side DOM assertions. The check helper received Vitest APIs from the tester document. Arbitrary checks that directly read their own `document` therefore need a different contract or integration. Default previews in a Vitest browser server also receive its module transforms; the failed lazy import is one measured consequence.

## Reproduce and sources

The experiment, pinned lockfile, source-inspection note and raw reports are archived under `spike-vitest-browser-fit-2026-09-28`. Restore that tag into a worktree and follow `spike/browser-mode/README.md`. Main retains findings only.

- [Pinned Vitest Node API declarations](https://unpkg.com/vitest@4.1.10/dist/node.d.ts) expose `createVitest`, `VitestPlugin`, and reporting types.
- [Pinned Browser Mode implementation](https://unpkg.com/@vitest/browser@4.1.10/dist/index.js), `createBrowserServer`, `assertBrowserApiWrite`, and the built-in file commands establish server and command ownership.
- [Pinned browser declarations](https://unpkg.com/@vitest/browser@4.1.10/context.d.ts), `BrowserPage.frameLocator`, document the public nested-frame API used here.
- [Pinned Playwright provider](https://unpkg.com/@vitest/browser-playwright@4.1.10/dist/index.js), `getCommandsContext`, `createContext`, and `close`, identify provider scope and cleanup.
- [Earlier modular evidence](authored-checks.md) records the original library and strict assertion-type experiments.

The installed copies of these pinned packages were inspected. Moving Vitest documentation was not used as evidence of the tested version's behavior.
