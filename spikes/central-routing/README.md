# Spike: central routing on one port

Status: run on 2026-09-30 on `zao`. Throwaway code. It answers one question for
decision 37: can one central app on one port serve any number of tabs, each on
any project, with real Vite HMR, and with no port range?

Answer: yes, in Chromium 149, over plain HTTP and over HTTPS through the
existing `caliper-tsnet` binary. 15 of 15 checks passed in both runs.
No other browser was tested.

## Design under test

| Piece | File | What it does |
|---|---|---|
| Central app | `central.mjs` | One port. Serves the chrome and the service worker. Forwards `/__caliper/p/<id>/<path>` to the project's Vite URL and upgrades `/__caliper/hmr/<id>`. Reads the registry at request time. |
| Service worker | `sw.js` | Scope `/`. Rewrites each request from a frame to `/__caliper/p/<id>/...`, from the frame's client URL. Returns the response under the URL the page asked for. |
| Plugin part | `project-plugin.mjs` | Project id from the root's path. Sets `server.hmr.path` to `__caliper/hmr/<id>`. Writes `registry/<pid>.json` (`0600`, directory `0700`). |
| Projects | `stack.mjs` | A copy of Pico (React 19.2.8) and a new React 18.3.1 project with a module worker and a lazy import. Vite picks each port. |

## Results

`nix develop -c node spikes/central-routing/verify.mjs --port 3141 [--via <url>]`

| Check | HTTP, 127.0.0.1:3141 | HTTPS, caliper.hummingbird-lake.ts.net:443 |
|---|---|---|
| Three tabs (Pico, React 18, both in one tab) render | Pass | Pass, 1,122 ms for all four frames |
| One React in each frame, of the right version | Pass | Pass: 19.2.8 and 18.3.1 |
| Every HMR socket goes to the central host at `/__caliper/hmr/<id>` | Pass | Pass, also with the default port 443 |
| A module worker and its import route to the project | Pass | Pass |
| A lazy import routes to the project | Pass | Pass |
| An edit in one project reloads its frames only | Pass | Pass |
| A CSS edit is a hot update, with no frame reload | Pass | Pass, 38 ms |
| A stopped service worker still routes frame and worker imports | Pass | Pass |
| A frame reload keeps its project | Pass | Pass |
| Hard reload, no recovery (observation) | Top page not controlled. Frames still controlled and rendered. | Same |
| Hard reload with recovery | One normal reload, then controlled | Same |
| A project restarts on a new port (5176 to 5178) and its open frames come back | Pass | Pass, 1,395 ms |
| No request reached the central app without a project | Pass | Pass |
| No browser errors | Pass (2 expected socket-loss messages during the restart) | Same |

## What broke on the way, and the fix

1. **Worker scripts lost their project.** Chromium sends a dedicated worker's
   script request with an empty `clientId`. A worker's own URL has no prefix,
   so the worker's imports had no project either. Fix: the service worker
   records the worker's `resultingClientId` and project in Cache storage. The
   record survives a stopped service worker. Without it, a worker's import
   after a stop went to the central app and got 404.
2. **Scope `/__caliper/` did not control workers.** A worker script such as
   `/src/echo.worker.ts` is outside that scope. Fix: scope `/`, with the
   `Service-Worker-Allowed: /` header. The central app owns the whole origin,
   so this costs nothing.
3. **Part edits reload the frame.** This is how Caliper's frame handles a part
   change today, with or without the central app. The CSS check shows that a
   true hot update works through the routing.

## What the spike does not prove

- Firefox and Safari. Service worker behaviour for workers and hard reload
  differs between browsers. The Fold uses Chromium-based browsers.
- The real chrome. The spike chrome is a bare page. Knobs, markup and the
  runtime read `contentDocument`; the frames share the chrome's origin, so
  this is inferred to work, not tested.
- A product that opens its own WebSocket, uses `localStorage` keys that clash
  with another product, or sets `server.hmr` itself.
- A product with `Referrer-Policy: no-referrer` whose frames follow plain
  links. The redirect for frame navigations uses the referrer.
- Load on the Fold over the tailnet. The HTTPS run used Chromium on `zao`.
- Shared workers and nested iframes inside a product frame.

## Try it

`nix develop -c node spikes/central-routing/up.mjs --port 3140` starts the stack
and keeps it running. `caliper-tsnet --upstream http://127.0.0.1:3140` puts it on
`https://caliper.hummingbird-lake.ts.net/`.
