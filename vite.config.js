import { fileURLToPath, pathToFileURL } from "node:url"
import { defineConfig } from "vite"
import { verifiedToolDirectory } from "./src/build/tool.js"

// This checkout is the subject. The tool is an independent, revision/lock-pinned
// installation outside the subject's write fence. Never fall back to ./src/plugin.
const tool = verifiedToolDirectory()
const { caliper } = await import(pathToFileURL(`${tool}/src/plugin.js`).href)
export default defineConfig({
  root: fileURLToPath(new URL("./", import.meta.url)),
  oxc: { jsx: { runtime: "automatic" } },
  // The Caliper app owns the take agent and its settings (decision 37); the plugin only serves this subject.
  plugins: [caliper({ entry: "src/client/ui/Chrome.tsx", css: [], wrap: false })],
  // Vite answers 403 for host names it does not know. These are this machine's tailnet names.
  server: { allowedHosts: ["zao", "zao.hummingbird-lake.ts.net"] },
})
