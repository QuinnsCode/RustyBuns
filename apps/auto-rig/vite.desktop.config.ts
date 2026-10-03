// A plain SPA build of the desktop entry (copied from fm-daw):
// no rwsdk/cloudflare plugins (they emit a Worker, not an index.html).
// Server-only modules become stubs and "use server" actions become host proxies
// via the .rustybuns/vite plugin, regenerated on every `rustybuns build desktop`.
import { defineConfig } from "vite";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { rustybuns } from "./.rustybuns/vite";

const req = createRequire(resolve(__dirname, "packages/desktop/package.json"));
const reactAlias = {
  react: resolve(req.resolve("react"), ".."),
  "react-dom": resolve(req.resolve("react-dom"), ".."),
  "react/jsx-runtime": req.resolve("react/jsx-runtime"),
};
export default defineConfig({
  plugins: [rustybuns()],
  root: resolve(__dirname, "packages/desktop"),
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      ...reactAlias,
    },
    dedupe: ["react", "react-dom"],
  },
  esbuild: { jsx: "automatic" },
  worker: { format: "es" },
  build: {
    outDir: resolve(__dirname, "dist/desktop"),
    emptyOutDir: true,
    sourcemap: true,
    target: "esnext",
    rollupOptions: { onwarn(w, warn) { if (w.code === "MODULE_LEVEL_DIRECTIVE") return; warn(w); } },
  },
});
