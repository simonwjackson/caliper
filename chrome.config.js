// The consumer's Vite never transforms this entry or resolves its dependencies.
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

const root = fileURLToPath(new URL("./", import.meta.url))
export default defineConfig({
  root,
  publicDir: false,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  oxc: { jsx: { runtime: "automatic" } },
  build: {
    outDir: "dist/chrome",
    emptyOutDir: true,
    manifest: true,
    target: "es2022",
    // Library mode otherwise writes one stylesheet the manifest does not list,
    // and chromeDelivery serves only manifest files: the chrome would load bare.
    cssCodeSplit: true,
    lib: { entry: `${root}src/client/app/entry.tsx`, formats: ["es"], fileName: () => "chrome.js" },
    rolldownOptions: {
      // The editor group leaves its dependencies in the entry, so the entry may
      // export more than the library entry declares. Nothing imports those names.
      preserveEntrySignatures: "allow-extension",
      output: {
        chunkFileNames: "[name]-[hash].js",
        codeSplitting: {
          groups: [{
            // These modules are reached only when an editor is opened. Keep the
            // UI-owned appearance in the same dependency graph as CodeMirror.
            name: "editor",
            test: id => /node_modules[\\/](?:@codemirror|@lezer|style-mod|w3c-keyname|crelt)[\\/]/.test(id)
              || /[\\/]client[\\/](?:code-editor\.js|ui[\\/]editor-appearance\.ts)$/.test(id),
            // Only the modules named above. Their shared dependencies (React and
            // the chrome's own modules) stay where the entry can load them eagerly.
            includeDependenciesRecursively: false,
          }],
        },
      },
    },
  },
})
