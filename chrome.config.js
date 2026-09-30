// The consumer's Vite never transforms this entry or resolves its dependencies.
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

const root = fileURLToPath(new URL("./", import.meta.url))
export default defineConfig({
  root,
  publicDir: false,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  esbuild: { jsx: "automatic" },
  build: {
    outDir: "dist/chrome",
    emptyOutDir: true,
    manifest: true,
    target: "es2022",
    // Library mode otherwise writes one stylesheet the manifest does not list,
    // and chromeDelivery serves only manifest files: the chrome would load bare.
    cssCodeSplit: true,
    lib: { entry: `${root}src/client/app/entry.tsx`, formats: ["es"], fileName: () => "chrome.js" },
    rollupOptions: {
      output: {
        chunkFileNames: "[name]-[hash].js",
        onlyExplicitManualChunks: true,
        // These modules are reached only when an editor is opened. Keep the
        // UI-owned appearance in the same dependency graph as CodeMirror.
        manualChunks(id) {
          if (/node_modules\/(?:@codemirror|@lezer|style-mod|w3c-keyname|crelt)\//.test(id)
            || /\/client\/(?:code-editor\.js|ui\/editor-appearance\.ts)$/.test(id)) return "editor"
        },
      },
    },
  },
})
