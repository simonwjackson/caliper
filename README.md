# Caliper

Caliper shows your project's own React components at their true physical size
on a target device, next to the variations an AI agent proposes for them.

> **Status: experimental (0.1.0).** Expect breaking changes between versions.
> Only Chromium is tested. Read [Limits](#limits) before you rely on it.

Caliper has two pieces:

- **The plugin**, `caliper()`, a dev-only Vite plugin. You add one line to the
  project's `vite.config`. It reads the project's source to find the parts, the
  global CSS and the app's outer shell, and it serves the frames. It never runs
  in `vite build`.
- **The Caliper app**, the `caliper` command. One process on one port shows
  every project whose dev server runs the plugin. It owns the AI agent and its
  settings. It never starts a project.

## Requirements

| Need | Version | Why |
|---|---|---|
| Node | 24 | The plugin and the app run in Node. Do not start Vite with `bun --bun`: renders need real Node. |
| Vite | 6, 7 or 8 | Caliper is a Vite plugin. The delivery gate runs Vite 6.4.2, 7.3.6 and 8.3.1. |
| React and React DOM | 18 or 19 | Parts render with the project's own React, through `react-dom/client`. |
| Chromium | Any recent | Only for renders, checks and the agent. Set `CHROMIUM`, or run `npx playwright-core install chromium` once. Browsing parts works in any Chromium-based browser without it. |
| A model endpoint and its API key | OpenAI-compatible, Anthropic or Gemini | Only for the agent. See [the guide](docs/guide.md#make-takes-with-an-agent). |

## Install

1. Add the dev dependency:

   ```sh
   npm install --save-dev @simonwjackson/caliper
   ```

2. Add the plugin to `vite.config`:

   ```ts
   import { caliper } from "@simonwjackson/caliper"
   import { defineConfig } from "vite"

   export default defineConfig({ plugins: [caliper()] })
   ```

   Keep your other plugins. Do not set the HMR socket's `path`, `port`,
   `clientPort`, `host` or `server`, under `server.ws` or `server.hmr`.
   Caliper routes that socket itself and refuses those settings.

3. Start the Caliper app once, and keep it running:

   ```sh
   npx caliper            # http://127.0.0.1:3132/__caliper/
   ```

4. Start the project's dev server with `npx vite`. The app lists the project
   at `http://127.0.0.1:3132/__caliper/`. Open it there.

5. Select **Calibrate** once for each monitor. Set the browser zoom to 100%.
   Hold a credit card to the screen and change px per mm until the outline
   matches the card.

The app and every dev server must run on one machine.

## Write a first part

A part is a file that ends in `.part.tsx`. It default-exports a component that
renders with no props:

```tsx
// src/Button.part.tsx
import { Button } from "./Button"

export const name = "Primary button"   // optional, shown in the list
export default function Part() {
  return <Button label="Go" />
}

// Each other exported component is another state of the same part.
export function Busy() { return <Button label="Go" busy /> }
```

Caliper finds the part by itself. Name the level in the file name, such as
`Home.page.part.tsx` or `Button.atom.part.tsx`, to sort the part list by
atomic design level.

## Make parts that Caliper can show

Caliper renders a part outside the running app. A part shows correctly only if
everything it needs comes from its own file:

- **Data comes in as props, from local fixtures.** A component that fetches
  its own data shows a spinner or an error. Keep fetching in a separate
  wrapper, and give the view component its data as props.
- **Actions are real handlers on local state.** A no-op callback does not
  become interactive inside a page.
- **Each component imports its own CSS.** Caliper injects only the stylesheets
  that the app entry imports directly. A component that forgot its import is
  unstyled, as it is in production when no other page loads that CSS.
- **Time and random values are fixed in the fixture.** If they are not, every
  render differs and image checks never match.
- **The app's outer shell is plain DOM with literal class names.** A provider
  or a computed `className` needs the `wrap` option. A provider that parts
  need cannot be recreated yet.

Caliper cannot check these rules for you. The [guide](docs/guide.md) and
[decision 18](docs/decisions.md#18-product-owned-working-scenarios) explain why.

## What else it does

- **Takes.** Describe a change and an agent makes one or more versions of the
  part. Each take is a folder of edited copies under `.caliper/takes/`. The real
  files change only when you accept a take.
- **Knobs.** Change a CSS custom property or a `@container` threshold while
  you watch, and Caliper writes it to the source file.
- **Code.** Edit the part's files in the app. Vite reloads the frames.
- **Checks.** Render each state twice and report errors, spill, accessibility
  problems and image changes against approved baselines.
- **`caliper-render`.** Render parts from the command line, for agents and CI.

The [guide](docs/guide.md) covers each of these, with every option.

## Security

The app's port has no login. Anyone who can reach it can read and write files
in every registered project and run the agent. The app listens on `127.0.0.1`
unless you pass `--host`. Read [SECURITY.md](SECURITY.md) before you expose it.

## Limits

- Only Vite and React projects can use Caliper. Only Chromium is tested.
- Caliper shows size and viewport truthfully. It cannot show pixel density,
  panel color or touch input.
- The standard devices (two phones, a tablet, a laptop and a monitor) are
  sized from spec sheets, not measured. Set `caliper({ devices })` for others;
  see [Devices](docs/guide.md#devices).
- Tailwind's source scan, Sass, Less and conditional CSS `@import` are not
  tested with takes and knobs.
- All projects share the app's origin, so they share `localStorage`,
  IndexedDB and cookies.

The [guide](docs/guide.md#limits) lists the rest.

## More

- [The guide](docs/guide.md): how Caliper finds things, options, takes, knobs,
  checks and rendering.
- [The decision record](docs/decisions.md): why Caliper works the way it does.
- [CONTRIBUTING.md](CONTRIBUTING.md): work on Caliper itself.
- [CHANGELOG.md](CHANGELOG.md).

MIT licensed. See [LICENSE](LICENSE).
