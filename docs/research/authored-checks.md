# Authored checks: library fit

## Result

A browser-local check can use DOM Testing Library queries, Chai assertions and a bounded Playwright input bridge. This combination worked through Caliper's existing Vite server and take overlay. It is the recommended direction, not an approved production API.

Keep check functions with their product states. Execute product and check modules in the browser, not Node. Reuse `playwright-core` for actual input. Caliper must own the check lifecycle and the small browser-to-driver transport, not new query or assertion semantics.

The accepted input decision remains in [the decision record](../decisions.md#authored-checks-browser-input). No authored-check feature, runtime dependency, report schema or UI change shipped with this research.

## What was tested

The throwaway consumer used real React state and an asynchronous local retry. It had a keyboard search form and a covered retry button. Its product module read `document` at module load, which is valid in the browser.

Each check ran in a fresh Chromium context on Caliper's actual frame route. The fixture emitted no page errors or external requests during the 48 scenario executions. The eight scenarios ran through three candidate engines at the RG353M and ODIN 2 PORTAL CSS viewport sizes. These are two sizes, not tests on two physical devices.

| Candidate | Verified result | Cost or limitation |
|---|---|---|
| DOM Testing Library + user-event + Chai | Retry, typing, Enter submission and take checks worked. It also clicked the covered button and reported success on both sizes. Click events had `isTrusted=false`. | Synthetic input can pass when the browser would deliver the click to another element. Do not use it as evidence of browser hit-testing. |
| Driver-side Playwright + Playwright expect | Retry, keyboard and take checks worked. It refused covered clicks. `toBeVisible` and `toHaveText` worked without the Playwright Test runner. | Checks lived in a separate Node module. Loading the whole part through Vite SSR failed with `document is not defined`. Executing arbitrary take-owned checks in Node expands their authority. |
| Browser-local queries and Chai + Playwright input bridge | Same functional results as driver-side Playwright, including refusal of covered clicks and `isTrusted=true`. Browser-authored check helpers followed the take tag. | Requires an input transport. The spike handles click, typing and a key press, not a complete interaction API or runner. |
| Bare `vitest/browser` import | Failed with its explicit outside-Browser-Mode error in the existing frame. | Not a standalone replacement. Adopting Vitest's complete runtime remains possible but was not tested. |

All 48 executions matched the experiment's expected outcomes. Ten check executions intentionally failed. Synthetic covered clicks are known incorrect successes, not evidence that those product states work.

The broken take kept the original check and failed. Another take changed both its heading and expected heading and passed. Original checks still passed afterward. The browser-local variants used Caliper's real take-tagged helper imports. The Node companion variant selected a direct file path, so it does not establish take-aware transitive Node imports.

The experiment confirmed a storage write before closing each context, then checked that the next context started empty. Lazy check imports kept the tested query/assertion dependencies out of ordinary preview requests. Discovery still listed only `default` and `Covered`, not lowercase check exports.

## Recommended ownership

| Owner | Responsibility |
|---|---|
| Product scenario | Supplies local data, starting state and real action behavior. |
| Check in the product module | Queries the rendered product and asserts outcomes in its browser context. |
| DOM Testing Library | Supplies `within`, asynchronous queries and `waitFor`. |
| Chai | Supplies browser-compatible assertions. Eventual assertions need `waitFor`; Chai does not retry them itself. |
| Existing Playwright driver | Sends browser input and performs click actionability checks. |
| Caliper | Supplies fresh contexts, run identity, deadlines, reporting and a bounded input transport. |

This direction needs DOM Testing Library and Chai plus their dependencies. It does not need user-event, a new Vitest runtime, or Playwright Test assertions in the product. The comparison spike installed those alternatives only to test them. Production dependency delivery and Vite resolution in consumers remain design work.

The transport does not implement role queries or matchers. It passes DOM element handles to a small set of driver operations. The spike uses public APIs from pinned Playwright 1.59.1, including `exposeBinding` with `handle: true`. Verify that API before upgrading; moving-version documentation is not the tested package contract.

## Work still required

The recommendation is a feasibility result, not permission to copy the bridge into production unchanged.

- DOM handles can become stale between query and input. Unlike Playwright locators, they do not re-resolve a replaced target. Define retry behavior without hiding product failures.
- Typing focuses an element and then uses page-wide keyboard input. Verify failed focus, redirected focus and concurrent calls. Trusted events alone do not establish that input reached the intended control.
- A timeout on an action or `waitFor` does not bound an arbitrary check promise. Add a check-wide deadline, cancellation and context cleanup. Test a hanging check.
- The spike rejects input outside the product host. That is an input guard, not a security sandbox. Validate run, document and origin identity across navigation and invalidation. Browser scripts retain same-origin authority. No network seal was implemented.
- Do not load agent-edited checks directly into the Vite server or another unrestricted Node process. That would give take code more authority than its current file-write tools. Isolated Node checks are an alternative architecture, not a small loading shortcut.
- Fix and test frame readiness separately. This experiment waited for its known heading; it did not fix the existing Empty-verdict race.
- Identify when a take changes checks as well as implementation. Passing modified expectations does not prove the old contract. Keep ordinary Replace reporting-only.
- Test browser errors, missing exports, malformed checks, source changes, timeouts, HMR and take-only states through discovery, CLI, agent and chrome reporting. Keep interaction results separate from initial-state visual baseline evidence.

No Firefox, WebKit, physical-device, live Pico or consumer typecheck was run. No dependency-size or performance comparison was made. Exact export syntax, assertion conveniences and production library wiring remain open.

## Reproduce and inspect

The source, pinned dependency lock, raw report and selected screenshots are archived under Git tag `spike-authored-check-fit-2026-09-28`. Main keeps this research note, not the disposable runner.

```sh
git worktree add /tmp/caliper-check-fit spike-authored-check-fit-2026-09-28
cd /tmp/caliper-check-fit
bun install
cd spike/authored-checks
nix shell nixpkgs#bun --command bun install --frozen-lockfile
CHROMIUM=/path/to/chromium nix shell nixpkgs#nodejs --command node run.mjs
nix shell nixpkgs#nodejs --command node summarize.mjs
```

`run.mjs` writes fresh evidence to a unique `/tmp/caliper-check-fit-evidence-*` directory. `summarize.mjs` validates the archived report. The archive's README gives exact versions and scope. Tested versions include Chromium 149.0.7827.200, Playwright 1.59.1, Vite 6.4.2, React 19.1.0, DOM Testing Library 10.4.1, user-event 14.6.1, Chai 5.3.3 and Vitest 4.1.10.

## Primary references

- [Testing Library's user-event introduction](https://testing-library.com/docs/user-event/intro/) describes simulated interactions through dispatched events. The complete page was inspected, then the covered-click difference was measured.
- [Playwright library guide](https://playwright.dev/docs/library) distinguishes library execution from the test runner. The experiment verified the two named assertions outside the runner; it did not verify screenshot assertions.
- [Vitest browser-context API](https://vitest.dev/api/browser/context) distinguishes provider input from simulation and explains the browser/driver split. The fetched page described a newer Vitest release than the installed 4.1.10 probe. The result here is explicitly version-bound.
- The archive includes the pre-spike primary-source survey at `docs/research/authored-check-library-sources.md`. Its initial synthetic-input recommendation is superseded by the covered-click evidence.
