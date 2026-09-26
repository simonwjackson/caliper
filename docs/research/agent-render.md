# Research: how an agent sees a rendered part

Date: 2026-09-26. Question: how should an AI agent render one Caliper part, state and device, and get back
a PNG and the errors? This decides the shape of foundation step 3. Each claim below names the source I read.

## What comparable tools do

| Tool | Shape | How the agent sees the result | Source |
|---|---|---|---|
| Storybook MCP (`@storybook/addon-mcp`) | An MCP server on the Storybook dev server, at `/mcp`. Setup is one `npx mcp-add` command. | It does not send screenshots to the agent. `stories-preview` renders the story in the chat if the client supports MCP Apps, and returns links if not. The agent checks its own work with `test-run`: interaction and accessibility tests. Storybook calls this a "self-healing loop". | [storybook.js.org/docs/ai/mcp/overview](https://storybook.js.org/docs/ai/mcp/overview) |
| Storybook Vitest addon | Runs each story as a Vitest test. | Vitest browser mode, with Playwright's Chromium by default. | [storybook.js.org/docs/writing-tests/integrations/vitest-addon](https://storybook.js.org/docs/writing-tests/integrations/vitest-addon) |
| `vite-plugin-mcp` (Anthony Fu) | A Vite plugin that adds an MCP server to the Vite dev server, at `/__mcp/sse`. It writes the agent's MCP config for VS Code, Cursor, Windsurf and Claude Code. Marked experimental. | Tools about the Vite config and the module graph. It does not render. | [vite-plugin-mcp README](https://github.com/antfu/nuxt-mcp-dev/tree/main/packages/vite-plugin-mcp) |
| Playwright CLI (`@playwright/cli`, Microsoft) | Shell commands plus a skill file, published next to Playwright MCP. | `playwright-cli screenshot` saves to a file. Microsoft's README says coding agents "increasingly favor CLI-based workflows exposed as SKILLs over MCP because CLI invocations are more token-efficient". It keeps MCP for long exploratory sessions. | [github.com/microsoft/playwright-cli](https://github.com/microsoft/playwright-cli) |
| Chrome DevTools MCP (Google) | An MCP server, and also a CLI. It drives its own Chrome. | Screenshots, console messages with source-mapped stack traces, viewport resize. It is a general browser tool and knows nothing about components. | [github.com/ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) |
| Storycap (reg-viz) | A CLI that takes the URL of a running Storybook: `storycap http://localhost:9009`. It needs no config. `--serverCmd` can also start the server. | One PNG for each story and viewport, written to a folder. It finds a local Chrome or takes `--chromiumPath`. | [github.com/reg-viz/storycap](https://github.com/reg-viz/storycap) |
| Vitest 4 browser mode | Test assertion `toMatchScreenshot`. | It compares against stored images. The docs warn that screenshots differ by browser and platform, so Vitest puts both in the file name. | [vitest.dev/guide/browser/visual-regression-testing](https://main.vitest.dev/guide/browser/visual-regression-testing) |

## How the image reaches the model

- **MCP.** A tool result can hold `image` content (base64 PNG) next to `text`, and a `structuredContent` JSON
  object. The image then goes to the model directly. Source: [MCP spec, tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools).
- **CLI.** The command writes a PNG and prints its path. The agent then reads the file. Verified in this
  session: the pi `read` tool shows PNG files as images. Claude Code's Read tool does the same (from its
  documentation, not tested here).
- **MCP Apps.** An official MCP extension since January 2026. A tool can return an interactive UI that the
  chat client renders. That shows the result to the person, not to the model. Source:
  [MCP Apps blog post](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/).

## What this means for Caliper

1. **Both options have first-party precedent.** A CLI that talks to a running server matches Storycap and
   Playwright CLI. An endpoint on the dev server matches Storybook MCP and `vite-plugin-mcp`, but as MCP, not
   as a custom HTTP route.
2. **Microsoft recommends CLI plus a skill for coding agents.** Its reason is token cost. MCP loads every tool
   schema into the context and can return large payloads. A CLI loads only what the agent asks for.
3. **Storybook's agent loop runs on checks, not only on pictures.** The agent fixes what the tests report. For
   Caliper, the frame already reports a structured result (`Rendered`, `Empty`, `Failed`, problems, stack
   traces). That JSON is the main signal. The PNG is for judging the look.
4. **A shared core keeps the choice open.** A render function in Caliper can serve a CLI now and an MCP tool
   later, in the style of Chrome DevTools MCP, which ships both.
5. **Headless images differ a little between machines.** Vitest's warning applies. The Nix Chromium pins the
   browser for this project.

## Not found

- I found no tool that renders a component at a device's CSS viewport and also reports physical size. The
  tools above use a pixel viewport only. Caliper's millimetre model has no direct precedent in agent tooling.
- I found no measurements of MCP against CLI token cost. The claims above are the vendors' own statements.
