# Central app and headless plugin

Status: planned on 2026-09-30. Nothing is built. Decision 37 in
`docs/decisions.md` records the choice and its costs. This file holds the
phases, the wire, and the gates.

## Split of work

| Piece | Today | After |
|---|---|---|
| Chrome page, assets, install files | Plugin, at `/__caliper/` | Central app |
| Project switcher | None | Central app |
| AI settings | `caliper({ agent })` in `vite.config` | `$XDG_CONFIG_HOME/caliper/config.json` |
| API key | Env of the shell that starts Vite | Env of the shell that starts the central app |
| Planner, take agents, Send (`src/agent/`) | Plugin | Central app |
| Agent renders (headless Chromium) | Plugin | Central app, against the project URL |
| Take store, overlay, Accept, Discard | Plugin | Plugin |
| Agent file access | In process, through `TakeStore` | Plugin endpoints that mirror `TakeStore` |
| Project skills (`.agents/skills/` up to the Git root) | Plugin reads disk | Plugin endpoints |
| User skills (`~/.agents/skills/`, `agent.skills`) | Plugin reads disk | Central app reads disk |
| Checks | Plugin | Plugin |
| Knobs writes, code pane files | Plugin | Plugin |
| Knobs CSSOM reads, markup, runtime | Chrome reads `contentDocument` | Chrome asks the frame bridge |
| `caliper-render` CLI | Reads the dev server | No change |

## Wire

All of this is frozen in phase 0 and changes only with a protocol raise.

**Registry file.** `$XDG_STATE_HOME/caliper/servers/<pid>.json`, with
`~/.local/state` when `XDG_STATE_HOME` is not set:

```json
{
  "protocol": 1,
  "pid": 41234,
  "root": "/home/me/code/pico",
  "name": "pico",
  "url": "http://127.0.0.1:5173/",
  "base": "/",
  "token": "<32 random bytes, base64url>",
  "started": "2026-09-30T12:00:00.000Z"
}
```

The plugin writes the file to a temporary name and renames it. It removes the
file on Vite `close`, `SIGINT` and `SIGTERM`. A crash leaves the file. The
central app checks each pid with `process.kill(pid, 0)` and deletes files whose
process is gone. A reused pid can make a dead entry look alive until a request
fails. The central app then marks the project unreachable.

**Token.** Requests send `Authorization: Bearer <token>`. The plugin compares
tokens in constant time. `/__caliper/frame` and Vite's own module URLs need no
token. `refuse()` in `src/http.js` drops its same-origin rule and checks the
token instead. The plugin answers `OPTIONS` with `Access-Control-Allow-Origin`
set to the request's origin and allows the `authorization` and `content-type`
headers.

**Protocol.** `PROTOCOL` is one exported integer. The registry file and a new
`GET /__caliper/hello` carry it. `hello` also returns the project name and
root, so the central app can confirm that the token reached the right server.

**Remote take store.** The agent code takes a `TakeStore`. The central app gets
`createRemoteTakeStore({ url, token })` with the same interface, so
`src/agent/tools.js` and `src/agent/take-agents.js` change little. Each method
becomes one endpoint under `/__caliper/store/`. The plugin runs the same fence
checks it runs today, and adds a test for `..`, absolute paths and symlinks
that leave the root.

**Skills.** `GET /__caliper/skills` lists the project's skill folders and their
`SKILL.md` front matter. `GET /__caliper/skills/file?skill=<name>&path=<path>`
returns one file inside one listed skill folder. The central app merges these
with user skills, and the first name wins, as in decision 25.

**Frame bridge.** The central app loads
`/__caliper/frame?...&parent=<central origin>`. The bridge accepts messages
only from `parent` and posts only to it. Each message has `{ id, type, ...}`
and each reply echoes `id`. The phase 0 contract lists every type that knobs,
markup and the runtime need. The contract derives the list from today's
`contentDocument` and `contentWindow` uses in `src/client/app/knobs.ts`,
`markup.ts` and `runtime.ts`.

**Events.** The central app reads `/__caliper/events` with `fetch` and the
token header, and parses the stream itself. Take progress no longer comes from
the plugin. The central app sends it to its own chrome.

## Phases

| Phase | Result | Gate |
|---|---|---|
| 0 | Freeze the wire above as schemas and types: registry file, `hello`, remote take store, skills, bridge messages, `PROTOCOL`. No behaviour changes. | Strict types pass. Schema tests pass with one valid and one refused example for each message. Existing tests pass. |
| 1 | The plugin writes and removes its registry file, requires the token, answers CORS and serves `hello`. The plugin puts the token in the chrome page it serves, so the chrome at `/__caliper/` keeps working. Until phase 5, anyone who can load that page can read the token. | A test starts two Vite servers and sees two registry files with modes `0600` and `0700`. Requests without the token get 401. A killed server leaves a file that the reader drops. |
| 2 | Add the frame bridge. Move knobs, markup and the runtime from `contentDocument` to messages. The chrome still runs at `/__caliper/`. | `scripts/verify-knobs.mjs`, `scripts/verify-knobs-product.mjs` and the markup checks pass on the bridge. A grep finds no `contentDocument` or `contentWindow` in `src/client/app/`. A message from another origin gets no reply. |
| 3 | Add the central app: a `caliper` bin that serves the chrome on one port, reads the registry, shows the switcher and connects to one project. The switcher's look is drawn before build under decision 34. It is not drawn here. | The central app shows Pico and a second project from two Vite servers, and switches between them without reload errors. A plugin with another protocol number shows in the switcher and does not connect. |
| 4 | Move `src/agent/` into the central app. Add `createRemoteTakeStore`, the store and skills endpoints, and the config file. Remove the `agent` option from the plugin. | The central app makes three takes on Pico and accepts one. The fence tests refuse `..`, absolute and symlink escapes through the endpoints. A project `vite.config` with `agent` fails with a message that names the config file. |
| 5 | Remove the chrome, assets and install files from the plugin. Move the install to the central app. Update the README, `vite.config.js` for self-hosting, the pinned tool and `caliper-render` docs. | `/__caliper/` on a project answers 404 with a message that names the central app. The install checks in `scripts/verify-pwa.mjs` pass against the central app. |
| 6 | Deploy. Run the pinned central app on Caliper itself and the checkout central app on Pico at the same time. | Both apps run on different ports. Each makes a take in its own project. Record the timing of 100 agent file reads through the plugin. |

## Not in scope

- Starting, stopping or configuring a project from the central app.
- Dev servers on another machine. Option B makes this possible later, but the
  registry is a local file.
- Support for older protocol numbers.
- Porting code from the `legacy` branch or `feat-zero-touch-onboarding`. Read
  them only for ideas.

## Open questions

- Which fixed port the central app uses. Phase 3 picks it.
- Whether checks move to the central app later, so only one shell needs
  `CHROMIUM`.
- Whether take progress needs to survive a central app restart. Today it does
  not survive a Vite restart either.
