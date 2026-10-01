# Contributing to Caliper

This file is for work on Caliper itself. To use Caliper in a project, read the
[README](README.md) and the [guide](docs/guide.md).

## Before you change the design

Read [the decision record](docs/decisions.md) before you change Caliper's
architecture. Change a settled decision only with new evidence, and record the
reason there. Before you change parts, states, takes, agent behavior or
verification, read
[decision 18](docs/decisions.md#18-product-owned-working-scenarios).

## Set up a checkout

The Nix dev shell gives Bun, Node 24 and `CHROMIUM`:

```sh
nix develop -c bun install
nix develop -c bun run build
```

Without Nix, install Bun 1.3 and Node 24, and set `CHROMIUM` to a Chromium
executable, or run `npx playwright-core install chromium`.

`bun run build` writes the chrome bundle to `dist/chrome`. Run it again after
every chrome change.

## Use a checkout in a project

Register the checkout once per machine, then link it from the project:

```sh
cd /path/to/caliper && bun install && bun run build && bun link
cd /path/to/project && bun add -d @simonwjackson/caliper@link:@simonwjackson/caliper
```

Start the app from the checkout with `nix develop -c node bin/caliper.mjs`.

## Test

```sh
nix develop -c env CALIPER_TEST_MODULES="$PWD/node_modules" bun test
nix develop -c bun run typecheck
```

Check the package the way a user installs it:

```sh
nix develop -c npm pack --pack-destination /tmp/caliper-pack
scripts/verify-clean-install.sh /tmp/caliper-pack/simonwjackson-caliper-*.tgz
```

CI (`.github/workflows/ci.yml`) runs the tests, the typecheck and the clean
install on every push and pull request.

## Record changes

Add a line under "Unreleased" in [CHANGELOG.md](CHANGELOG.md) for each change
that a user can see. Use [Conventional Commits](https://www.conventionalcommits.org/)
for commit messages, for example `fix(central): ...`.

## The chrome

The chrome is the Darkroom design (decision 34), built in React
(`src/client/ui/Darkroom.tsx`). Tools sit on a rail at the left on a desk and
in a dock at the bottom on a phone. Takes are on the canvas, with the composer
bar under it. Knobs and the selected take's record share a side panel. Every
region has a `*.part.tsx` beside it, so Caliper can show and edit its own
chrome. The unstyled reference (`src/client/ui/Chrome.tsx`) stays as the
contract's executable spec. See
[`docs/plans/react-chrome.md`](docs/plans/react-chrome.md) for the merge record.

To rebuild the app's icons after you change chrome colors, run
`nix develop -c node scripts/gen-icons.mjs`. Run
`nix develop -c node scripts/verify-pwa.mjs` to check the install metadata and
browser installability on a test product.

## Run the app as a service

`deploy/` holds one example setup: a systemd user service for the app, and an
optional tailnet TLS proxy in front of it. Run `deploy/install.sh` from the
checkout that the service must use. It is not part of the package.

## Develop

The app state in `src/client/app/` drives the Darkroom renderer through the
contract in [`docs/plans/react-chrome.md`](docs/plans/react-chrome.md).
Caliper builds React/React DOM and lazy CodeMirror chunks into
`dist/chrome`; the Caliper app serves them under `/__caliper/assets/`, and
the consumer's Vite never resolves them. Product frames still use the consumer's
React. A linked checkout needs `bun run build` after chrome changes. `bun pack`
builds the artifacts through `prepack`. Consumer production builds omit Caliper.

## Edit Caliper with Caliper: the recovery tool

This is for contributors only. The recovery tool installs from this Git
checkout with `git archive`, so it does not work from an npm install.

Self-hosting uses a separate recovery tool, pinned to one commit
(`TOOL_REVISION` in `src/build/tool.js`), not this checkout's plugin. Install
it with `nix develop -c bun run tool:install`, then run
`nix develop -c bun run dev` and the tool's own Caliper app with
`nix develop -c bun run tool:app` (port 3133), and open this checkout from it.
The tool shows the chrome's
own parts (the bar, the canvas, the side panel and the rest) as this
checkout's source, and its take agent edits them. Its archive, source and lock
hashes are checked before startup, and the install builds its own chrome
bundle. To restore a missing or changed copy, run
`nix develop -c bun run tool:install -- --repair`. A bad accept breaks only
this checkout, never the tool you use to undo it. The pin moves only by hand:
commit the change, run `scripts/tool-pin-hashes.mjs <commit>`, put the four
values in `src/build/tool.js`, and install with `--repair`.

## Verify in a real browser

`nix develop -c node scripts/verify-central.mjs` checks the app with the real
chrome and plugin: two projects on ports Vite picks, tabs on each, HMR, web
workers, a stopped service worker, a hard reload, a restart on a new port, the
switcher, the token and one take through the host endpoint. `--via <url>`
runs it through a TLS proxy.

Run the unchanged contract gate with
`nix develop -c bun run verify:chrome-contract`. Run live public gates on
disposable consumers with `nix develop -c node scripts/verify-chrome-core.mjs`.
The latter runs 21 gates against the built Darkroom chrome, layout assertions
included. It uses a deterministic local model endpoint for take transport, not
a paid model. Run `nix develop -c bun run verify:chrome-delivery` for
linked/packed React-major isolation, source HMR, lazy editor delivery and
pinned-tool self-hosting. Run `nix develop -c node scripts/ui/verify.mjs` for the
Darkroom regions: 26 fixtures at three sizes, every hook, keyboard, frame and
editor preservation, and reachability at eight sizes. None of these prove
real-device input.

```sh
nix develop -c bun install
nix develop -c bun run build
nix develop -c env CALIPER_TEST_MODULES="$PWD/node_modules" bun test
nix develop -c bun run typecheck
CHROMIUM=/path/to/chromium CALIPER_TEST_MODULES=/path/to/react-project/node_modules bun test test/navigation.test.js
CHROMIUM=/path/to/chromium bun run verify:browser -- --url http://127.0.0.1:5173 --root /path/to/project
CHROMIUM=/path/to/chromium node scripts/verify-css-loading.mjs --modules /path/to/react-project/node_modules
CHROMIUM=/path/to/chromium node scripts/verify-integration.mjs --modules /path/to/react-project/node_modules
CHROMIUM=/path/to/chromium ./scripts/verify-attachments.mjs --modules /path/to/react-project/node_modules
CHROMIUM=/path/to/chromium node scripts/verify-scenarios.mjs --modules /path/to/react-project/node_modules
CHROMIUM=/path/to/chromium node scripts/verify-checks.mjs --modules /path/to/react-project/node_modules
CHROMIUM=/path/to/chromium ./scripts/verify-authored-agent-cli.mjs --modules /path/to/react-project/node_modules
CHROMIUM=/path/to/chromium node scripts/verify-checks-ui.mjs --modules /path/to/react-project/node_modules
CHROMIUM=/path/to/chromium node scripts/verify-expectations.mjs --modules /path/to/react-project/node_modules
CHROMIUM=/path/to/chromium node scripts/verify-frame-commit.mjs --modules /path/to/react-project/node_modules
CHROMIUM=/path/to/chromium node scripts/verify-authored-checks.mjs --modules /path/to/react-project/node_modules
CHROMIUM=/path/to/chromium node scripts/verify-authored-agent-cli.mjs --modules /path/to/react-project/node_modules
CHROMIUM=/path/to/chromium node scripts/verify-authored-ui.mjs --modules /path/to/react-project/node_modules
CHROMIUM=/path/to/chromium node scripts/verify-authored-package.mjs
CHROMIUM=/path/to/chromium node scripts/verify-code.mjs --url http://127.0.0.1:5173 --root /path/to/project --part src/ui/atoms/Button.atom.part.tsx
CHROMIUM=/path/to/chromium node scripts/verify-fast-saves.mjs
CHROMIUM=/path/to/chromium node scripts/verify-knobs.mjs --modules /path/to/react-project/node_modules
CHROMIUM=/path/to/chromium node scripts/verify-knobs-product.mjs --root /path/to/project --part src/Button.part.tsx
```

`scripts/verify-knobs.mjs` runs the Knobs panel on a temporary project shaped
like Pico's tokens: discovery and refusals, live input that writes the
file once on commit, a `@container` threshold, a plain custom property, literal
promotion, token choices, a take's copy, HMR during input and five window sizes.
Label-pointer scrubbing, capture and dock/sheet layout remain deferred on the
reference. Screenshots go to
`/tmp/caliper-verify-knobs`. `scripts/verify-knobs-product.mjs` copies a real
project to a temporary folder, prints every knob and refusal Caliper finds for
one part, previews and commits the first number knob of a property, a plain
custom property and a `@container` threshold, then lists literals and makes
the first one a token, and checks that no element of the part changed its
value. `--with ../../contracts` copies a
folder the project imports from, at the same place. The real project never
changes.

`scripts/verify-fast-saves.mjs` checks that a page shows the last of two saves
made 20 ms apart, before and after a reload. Vite's own watcher drops the second
save; `PLAIN=1` runs the same check without Caliper and shows that bug.
`ATOMIC=1` saves by renaming a temporary file, as many editors do.

`scripts/verify-css-loading.mjs` creates a temporary React project and starts
real Vite servers. It checks exact stylesheet sets, shared motion, CSS modules,
missing imports, hot reload, take isolation, explicit globals and Setup
provenance. The supplied `node_modules` must contain React and React DOM. The
check neither changes the supplied project nor uses its Vite cache.

`scripts/verify-scenarios.mjs` runs a local interactive consumer in real Vite and
Chromium. It checks parent-owned state changes, transitive scenario browsing,
state-owned takes, composed CSS overrides, frame isolation, URL restoration,
five container sizes, related renders, stale declarations, removed-state take
recovery and retained preview errors. It makes no model
calls and changes no supplied project files.

`scripts/verify-checks-ui.mjs` exercises the Checks window through real Chromium:
run progress, findings, saved-image approval, stale results, page reload, take
selection and unchanged Replace. Add `--layout` after UI integration to require
five size-ladder shapes, embedded-container containment and focus restoration.
These assertions remain in the script; the reference explicitly defers them.

`scripts/verify-checks.mjs` uses a temporary React consumer to check the public
CLI, both device sizes, render errors, browser errors, empty states, spill,
accessibility failures, unstable images, saved-baseline approval, take comparison,
and the agent tool's findings. It also proves that reports do not block Replace.
It makes no model calls or changes to the supplied project.

`scripts/verify-code.mjs` checks the code pane against a running dev server.
It types in a real file and checks that the file on disk changes, no take
starts and the frame renders. Then it undoes the edit and checks that the file
is back. It starts a take in the project at `--root`, and checks the take's
frame, the diff and its line count, Revert, the state lenses, and samples
four window sizes. Add `--reference` to report its layout gates as deferred
when you run it against the unstyled reference renderer. It makes no model calls. It writes the real file back and
discards every take it starts, even when a step fails. Pick a part with two or
more states to check the lenses.

`scripts/verify-takes.mjs` checks takes on the canvas against a configured model: it
starts takes from the chrome, waits for the agents, checks every take frame,
takes screenshots at three window sizes and discards the takes. With
`--accept --root <project>` it first accepts one take through the chrome,
checks that the take's files replaced the real ones and that the other takes
remain. Run that against a scratch checkout: the accepted edit is real.

`scripts/verify-integration.mjs` checks alternate preview, unchanged original
renders, real click behavior, revision-bound review/apply, and review controls at
five container sizes. Against the unstyled reference renderer, add
`--reference` to defer that containment gate. It uses a temporary React consumer. Add `--live` to also
exercise naming and alternate preparation with a real model. `--live`,
`verify-markup-model.mjs` and `verify-references-model.mjs` use the agent in
`~/.config/caliper/config.json` and the key in the script's own environment;
the last two take `--model` to try another model on that endpoint.

`nix develop` provides Bun, Node and `CHROMIUM`. The browser check renders
every part of a running project and checks calibration actions, a visible error
and reload on save. It reports final physical sizing, overflow and height-budget
layout as deferred on the reference. It writes screenshots to
`/tmp/caliper-verify`.

The design decisions behind this shape are in
[`docs/decisions.md`](docs/decisions.md). The previous, larger Caliper is on
the `legacy` branch.
