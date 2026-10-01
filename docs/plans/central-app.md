# Central app and headless plugin

Status: phases 0 to 5 built on 2026-09-30, in one branch; phase 6 (deploy) in
the build record at the end. The routing spike in
`spikes/central-routing/` (now removed; `scripts/verify-central.mjs` replaces it) passed 15 of 15 checks in Chromium 149, over HTTP and
over HTTPS through `caliper-tsnet` (`2f330a0`, results in `2122c55`). Decision 37
in `docs/decisions.md` records the choice and its costs. This file holds the
split of work, the wire, the phases and the gates.

## Split of work

| Piece | Today | After |
|---|---|---|
| Chrome page, assets, install files | Plugin, at `/__caliper/` | Central app, at `/__caliper/` |
| Project switcher | None | Central app |
| Routing to projects | None | Central app: `/__caliper/p/<id>/`, `/__caliper/hmr/<id>`, a service worker |
| AI settings | `caliper({ agent })` in `vite.config` | `$XDG_CONFIG_HOME/caliper/config.json` |
| API key | Env of the shell that starts Vite | Env of the shell that starts the central app |
| Planner, take agents, Send (`src/agent/`) | Plugin | Central app |
| Agent renders (headless Chromium) | Plugin | Central app, against the project's Vite URL |
| Take store, overlay, Accept, Discard | Plugin | Plugin |
| Agent file access | In process, through `TakeStore` | Plugin endpoints that mirror `TakeStore` |
| Project skills (`.agents/skills/` up to the Git root) | Plugin reads disk | Plugin endpoints |
| User skills (`~/.agents/skills/`, `agent.skills`) | Plugin reads disk | Central app reads disk |
| Checks | Plugin | Plugin |
| Knobs writes, code pane files | Plugin | Plugin |
| Knobs CSSOM reads, markup, runtime | Chrome reads `contentDocument` | No change: frames share the chrome's origin |
| `caliper-render` CLI | Reads the dev server | No change |

## Wire

Phase 0 freezes all of this. It changes only with a protocol raise.

**Registry file.** `$XDG_STATE_HOME/caliper/servers/<pid>.json`, with
`~/.local/state` when `XDG_STATE_HOME` is not set:

```json
{
  "protocol": 1,
  "id": "2e5778d2b4c4",
  "pid": 41234,
  "root": "/home/me/code/pico",
  "name": "pico",
  "url": "http://127.0.0.1:5173/",
  "base": "/",
  "token": "<32 random bytes, base64url>",
  "started": "2026-09-30T12:00:00.000Z"
}
```

`id` is the first 12 hex digits of the SHA-256 of the root's real path. The
plugin writes the file to a temporary name and renames it. It removes the file
on Vite `close`, `SIGINT` and `SIGTERM`. A crash leaves the file. The central
app checks each pid with `process.kill(pid, 0)` and deletes files whose process
is gone. A reused pid can make a dead entry look alive until a request fails.
The central app then shows the project as unreachable. Two live entries with
the same id (the same root served twice) are a problem that the switcher shows. The
central app routes to neither.

**Routing paths.**

| Path | Owner | Behaviour |
|---|---|---|
| `/__caliper/` | Central app | The chrome. |
| `/__caliper/sw.js` | Central app | The service worker, sent with `Service-Worker-Allowed: /`. |
| `/__caliper/api/...` | Central app | Projects, takes, agent, settings. |
| `/__caliper/p/<id>/<path>` | Central app | Forwards `<path>` to the project's Vite URL, adds the token, sets `Host` to the upstream host. Rewrites a root-relative `Location` header into the prefix. |
| `<base>__caliper/hmr/<id>` upgrade | Central app | Forwards the WebSocket upgrade to the project. |
| Any other path | Central app | 404 that names the path. With the service worker in control, only a hard reload reaches this. |

**Service worker.** Scope `/`. It carries the spike's `sw.js` logic:

- A navigation inside a frame is redirected to its prefix by the referrer.
- A request from a client whose URL is under `/__caliper/p/<id>/` is fetched
  from the prefixed path and returned under the original URL.
- A web worker started from such a client gets a record in Cache storage,
  `caliper-clients`, keyed by its client id. Records of gone clients are
  deleted on activate.
- Every other request passes through.

**Token.** Requests send `Authorization: Bearer <token>`. The plugin compares
tokens in constant time. `/__caliper/frame`, Vite's module URLs and the HMR
socket need no token. `refuse()` in `src/http.js` checks the token for writes.
The central app refuses a request other than GET or HEAD when its `Origin` is
not its own.

**Protocol.** `PROTOCOL` is one exported integer. The registry file and a new
`GET /__caliper/hello` carry it. `hello` also returns the project id, name and
root, so the central app can confirm that it reached the right server, and any
setup problem, such as a refused `server.hmr` setting.

**Remote take store.** The agent code takes a `TakeStore`. The central app gets
`createRemoteTakeStore({ url, token })` with the same interface, so
`src/agent/tools.js` and `src/agent/take-agents.js` change little. Each method
becomes one endpoint under `/__caliper/store/`. The plugin runs the same fence
checks it runs today, and adds tests for `..`, absolute paths and symlinks that
leave the root.

**Skills.** `GET /__caliper/skills` lists the project's skill folders and their
`SKILL.md` front matter. `GET /__caliper/skills/file?skill=<name>&path=<path>`
returns one file inside one listed skill folder. The central app merges these
with user skills, and the first name wins, as in decision 25.

**Events.** The chrome reads a project's `/__caliper/events` through
`/__caliper/p/<id>/`. The central app adds the token. Take progress comes from
the central app's own event stream, because the agent runs there.

## Phases

| Phase | Result | Gate |
|---|---|---|
| 0 | Freeze the wire above as schemas and types: registry file, routing paths, `hello`, remote take store, skills, `PROTOCOL`. No behaviour changes. | Strict types pass. Schema tests pass with one valid and one refused example for each message. Existing tests pass. |
| 1 | The plugin writes and removes its registry file, serves `hello`, sets `server.hmr.path`, and refuses a project with its own `server.hmr` path, port, client port or server. It requires the token, and until phase 5 also accepts today's same-origin rule, so the chrome at `/__caliper/` keeps working without the token in its page. | A test starts two Vite servers and sees two registry files with modes `0600` and `0700`. A request without the token or a same origin gets 401. A killed server leaves a file that the reader drops. The existing chrome and HMR still work on a project's own port. |
| 2 | Add the central app's routing: a `caliper` bin on one port that reads the registry, forwards `/__caliper/p/<id>/` and `/__caliper/hmr/<id>`, serves the service worker, and serves the existing Darkroom chrome with its project API base set to `/__caliper/p/<id>/__caliper/`. The project comes from the URL, for example `/__caliper/#project=<id>`. Move the spike's verifier to `scripts/verify-central.mjs` and delete `spikes/central-routing/`. | The spike's 15 checks pass against the real chrome, over HTTP and through `caliper-tsnet`. Two tabs show Pico and a second project. `scripts/verify-knobs-product.mjs` and the markup checks pass through the central app. |
| 3 | Add the project switcher. Its look is drawn before the build, under decision 34. It is not drawn here. | The switcher lists live projects and updates when a server starts or stops. A plugin with another protocol number, a dead project and a duplicate id each show with the reason and do not connect. Switching in one tab leaves another tab on its own project. |
| 4 | Move `src/agent/` into the central app. Add `createRemoteTakeStore`, the store and skills endpoints, and the config file. Remove the `agent` option from the plugin. | The central app makes three takes on Pico and accepts one. The fence tests refuse `..`, absolute and symlink escapes through the endpoints. A project `vite.config` with `agent` fails with a message that names the config file. |
| 5 | Remove the chrome, assets, install files and the same-origin rule from the plugin. Move the install to the central app. Update the README, `vite.config.js` for self-hosting, the pinned tool and the `caliper-render` docs. | `/__caliper/` on a project's own port answers 404 with a message that names the central app. `scripts/verify-pwa.mjs` passes against the central app. |
| 6 | Deploy. Replace the installed legacy app (see below) with the checkout central app at `https://caliper.hummingbird-lake.ts.net`. Run the pinned central app on Caliper itself on another port. | `caliper.service` runs the central app on port 3132, not `bin/caliper.mjs`. `caliper-proxy.service` serves it on the tailnet name `caliper`. On the Fold, two tabs show Pico and a second project, and each makes a take. Both units are enabled and start after a reboot. One Firefox run is recorded, pass or fail. Record the timing of 100 agent file reads through the plugin. |

## Replace the installed legacy app

Checked on 2026-09-30 on `zao`:

| Item | State |
|---|---|
| `~/.config/systemd/user/caliper.service` | Disabled, inactive. Runs `nix develop --command bun ./bin/caliper.mjs --port 3132 --browse-root /home/simonwjackson/code` in the main checkout. Drop-in `caliper.service.d/nofile.conf` sets `LimitNOFILE=65536`. |
| `bin/caliper.mjs` | Gone from `main`. It was the legacy multi-project launcher, last seen in `feat-zero-touch-onboarding`. The unit cannot start today. |
| `~/.config/systemd/user/caliper-proxy.service` | Disabled, inactive. Runs `~/.local/bin/caliper-tsnet --name caliper --state ~/.config/caliper-tsnet --upstream http://127.0.0.1:3132`. |
| Tailnet node `caliper` (`100.76.133.33`) | Was offline for 23 days. The spike ran it by hand with `--upstream http://127.0.0.1:3140`, and it served the spike over HTTPS. |
| `caliper-tsnet` | Source not found in this repository. It takes one `--upstream`, which is all the central app needs. |

The replacement keeps the tailnet name, the tsnet state, the binary and
`caliper-proxy.service`. It rewrites `caliper.service` to start the central app
from the main checkout on port 3132, with no `--browse-root`. The central app
starts no projects, so the launcher behaviour of the legacy app goes away. The
deploy step writes both unit files from a `deploy/` directory in this
repository, outside `src/` and the package, so the installed units stop
drifting from the code.

## Not in scope

- Starting, stopping or configuring a project from the central app.
- Dev servers on another machine. The agent's file access goes through plugin
  endpoints, so this is possible later, but the registry is a local file.
- Support for older protocol numbers.
- Routing a product's own WebSockets.
- Separate storage for each product.
- Porting code from the `legacy` branch or `feat-zero-touch-onboarding`. Read
  them only for ideas.

## Open questions

- Whether checks move to the central app later, so only one shell needs
  `CHROMIUM`.
- Whether take progress needs to survive a central app restart. Today it does
  not survive a Vite restart either.
- How Firefox and Safari handle web worker requests and hard reloads through
  the service worker. Phase 6 records one Firefox run.
- Whether shared `localStorage` between products causes trouble in practice.
  A fix would need a separate origin for each project, which decision 37 rules
  out for now.

## Build record

Built on 2026-09-30 in one branch, not phase by phase: the phases share the
wire, and a half-moved agent has no working state to land. Decision 37's
"Built" section lists the choices made while building.

| Phase | Result | Evidence |
|---|---|---|
| 0 | `src/central/registry.js` (entry, `PROTOCOL = 1`), `src/host/wire.js` (the host calls). No separate schema module: the registry reader and the host dispatcher check their own input. | `test/central.test.js`: registry modes, dead-server cleanup, ids, tokens, duplicate and protocol views, wire encoding. |
| 1 | The plugin registers, serves `hello`, sets the HMR path, refuses `server.hmr` settings and `agent`, and takes writes only with its token. The same-origin rule was not kept for an interim; it goes in the same change. | `test/central.test.js`: 401 without the token, the fence through `host` (`..`, absolute path, symlink), unknown calls refused. |
| 2 | `bin/caliper.mjs` and `src/central/server.js`: routing, the service worker, the chrome at `/__caliper/p/<id>/<base>__caliper/`. The spike moved to `scripts/verify-central.mjs`. | `scripts/verify-central.mjs`: 15 of 15 checks with the real chrome and plugin. |
| 3 | The Project menu in the parts panel (`CAL.project`, `onProject`), and the project list at `/__caliper/`. Not drawn as a mockup first: it is one labelled select in the style of the Preview row. | `scripts/ui/verify.mjs`: 317 gates, 111 hooks. The switcher check in `verify-central.mjs`. |
| 4 | The agent runs in a worker thread per project; its store, marks, integration, parts and project skills are calls to the plugin. Settings in `~/.config/caliper/config.json`. | `verify-central.mjs` makes a take through `host`. All 672 unit tests and every browser gate below run the agent through the app. |
| 5 | The plugin serves no chrome, assets or install files; `/__caliper/` on it answers 404 and names the app. README, self-hosting `vite.config.js`, `bun run tool:app`, the `caliper-render` skill. | `test/pages.test.js`, `test/chrome-delivery.test.js`; `scripts/verify-pwa.mjs` against the app. |

Gates run on the branch: `bun test` (all pass), `tsc`, `verify-chrome-core.mjs`
(22 gates), `verify-chains`, `verify-markup`, `verify-references`,
`ui/verify-served-typeahead`, `verify-chrome-contract` (19 scenarios, 111
hooks), `ui/verify.mjs`. Not run: `verify-markup-model` and
`verify-references-model` (a paid model).

### Deploy on zao, 2026-09-30

| Check | Result |
|---|---|
| `deploy/install.sh` | Wrote and enabled `caliper.service` (the app on 3132, from the main checkout) and `caliper-proxy.service` (`caliper-tsnet` to 3132). Both active; both start with the user session. A reboot was not tested. |
| Settings | `~/.config/caliper/config.json`: `claude-opus-5-5`, reasoning medium. Endpoint and key from `~/.pi/agent/cliproxyapi.json`. |
| Projects | Pico (Vite on `[::1]:5173`) and amaze-next (`100.114.19.92:5199`) both Ready. The IPv6 address exposed a proxy bug, fixed in `71ecc0f`. |
| Through `https://caliper.hummingbird-lake.ts.net` (Chromium on zao) | Project list with 2 links. A Pico tab rendered in 683 ms and an amaze-next tab in 1,560 ms. The switcher listed both. Both HMR sockets went to the tailnet name at their project's path. No page errors. |
| A take with the real model | Pico, take 5: `activate_skill`, `name_take`, `read_file`, `edit_file`, `render` twice, all Done, through the plugin's host endpoint. Discarded after. |
| 100 agent file reads through the plugin | 334 ms, about 3.3 ms each (HTTP to the plugin; the worker's own hop not included). |
| Pinned tool | Moved to `71ecc0f`. `verify:chrome-delivery` passed linked, packed and self-host. `bun run tool:app` served both projects on 3133. |
| Not done | The Fold itself, Firefox, and a reboot. The HTTPS run used Chromium on zao. |

