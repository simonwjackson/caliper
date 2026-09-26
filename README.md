# Caliper

Caliper is a dev-only Vite plugin. It shows a project's own UI parts at their
true physical size on a target device.

You add one line to the project's `vite.config`. Caliper then reads the
project's source to find the parts, the global CSS and the app's outer shell.
It does not run the app to do this.

## Use it

1. Register this checkout once per machine:

   ```sh
   cd /path/to/caliper && bun install && bun link
   ```

2. In the project, add the dev dependency and the plugin:

   ```sh
   bun add -d @simonwjackson/caliper@link:@simonwjackson/caliper
   ```

   ```ts
   // vite.config.ts
   import { caliper } from "@simonwjackson/caliper"
   import { defineConfig } from "vite"

   export default defineConfig({ plugins: [caliper()] })
   ```

3. Run `vite` in the project and open `/__caliper/` on the dev server.

4. Select **Calibrate** once for each monitor. Set the browser zoom to 100%,
   hold a credit card to the screen and move the slider until the outline
   matches the card.

`vite build` never includes Caliper. The plugin sets `apply: "serve"`.

## What Caliper finds by itself

| Need | Where Caliper looks |
|---|---|
| Parts | Every `*.part.tsx` file. In a Git checkout, ignored files do not count. `node_modules` never counts. |
| App entry | The first `<script type="module" src>` in `index.html`, then `package.json` `exports["."]`, then `main`. |
| Global CSS | Each stylesheet imported for its side effect (`import "./app.css"`), reachable from the entry through static imports, in load order. |
| Wrapper | The `createRoot(...).render(<App />)` call reachable from the entry. Caliper reads the outermost DOM elements `App` returns, when their `className` is a literal. |

The **Setup** panel at the bottom of the part list shows each value and the
file and line it came from. When Caliper cannot find a value, the panel says why
and names the option that fixes it.

A part file default-exports a component that renders with no props:

```tsx
export const name = "Primary button"            // optional, shown in the list
export const note = "The main call to action"   // optional
export default function Part() {
  return <Button label="Go" />
}
```

A part file can also show other states of the same component. Each exported
component whose name starts with an upper-case letter is a state. The part list
shows the states under the selected part, and makes each label from the export
name:

```tsx
export const Busy = () => <Button label="Go" busy />       // "Busy"
export function NoResults() { return <Button label="Retry" /> } // "No results"
```

**All states** in that list shows every state side by side on the selected
device. Each state has its own frame, so one that throws fails alone. All
frames have the same size: true size when one frame fits the window, or scaled
down together when not. More states add rows that scroll. Click a frame's label
to show that state alone.

## Options

Set an option only when the Setup panel reports a failure.

```ts
caliper({
  entry: "src/main.tsx",             // the module the app starts from
  wrap: ["app-theme", "app-screen"], // outer element class names, outermost first
})
```

`wrap: false` renders parts with no wrapper.

## How a part renders

Each part renders in an `iframe` for one device. The `iframe` has the device's
CSS viewport size, for example 640 × 480 px for the RG353M. It is then scaled to
the device's physical width on the calibrated monitor. Media queries, `vw` and
`window.innerWidth` inside the frame therefore see the device, not the monitor.

Inside the frame, Caliper loads the global CSS, then the project's own React,
then the part. It renders the part inside the wrapper elements. A save in the
project reloads the frame. Caliper's own page loads no project code and no
React.

Every failure is visible. A part that fails to load, has no default export,
throws while rendering or renders nothing shows the reason in the frame and,
at a readable size, under the stage. When the window is too small for true
size, the frame is drawn smaller and the caption says by how much.

## Let an agent see a part

`caliper-render` renders a part of the running project in a headless Chromium,
at a device's CSS viewport, and prints what it found as JSON:

```sh
CHROMIUM=/path/to/chromium caliper-render --url http://localhost:5173 \
  --part src/ui/atoms/Button.atom.part.tsx --state '*' --device '*'
```

Each result gives the frame's verdict (`Rendered`, `Empty` or `Failed`), the
problems the frame shows, browser errors it did not catch, the elements that
reach past the device's screen, and the path of a PNG at one image pixel per
CSS pixel. `--list` prints every part and its states. `--help` explains every
field. The exit status is 0 when every frame rendered.

`skills/caliper-render/SKILL.md` teaches an agent the loop: render, read the
verdict, look at the PNGs, change the code, render again. Copy or link it into
the agent's skills folder.

## Limits

- Caliper shows size and viewport truthfully. It cannot show pixel density,
  panel colour or touch input.
- The wrapper must be DOM elements with literal class names. A provider
  component or a computed `className` needs the `wrap` option, and a provider
  that parts need cannot be recreated yet.
- The device list is built in: RG353M and ODIN 2 PORTAL. Their CSS viewports
  are inferred from each panel's resolution and Sway's default scale of 1. They
  are not yet measured on the devices.
- Only Vite projects can use Caliper.

## Develop

```sh
bun install
bun test
bun run typecheck
CHROMIUM=/path/to/chromium bun run verify:browser -- --url http://127.0.0.1:5173 --root /path/to/project
```

`nix develop` provides Bun, Node and `CHROMIUM`. The browser check renders
every part of a running project and checks true size, scaling, calibration, a
visible error and reload on save. It writes screenshots to
`/tmp/caliper-verify`.

The design decisions behind this shape are in
[`docs/decisions.md`](docs/decisions.md). The previous, larger Caliper is on
the `legacy` branch.
