// A plain SPA build of the desktop entry (as auto-rig's): server-only modules become stubs and
// "use server" actions become host proxies via the .rustybuns/vite plugin.
import { defineConfig } from "vite";
import { resolve } from "node:path";
import { rustybuns } from "./.rustybuns/vite";

export default defineConfig({
  plugins: [rustybuns()],
  root: resolve(__dirname, "packages/desktop"),
  publicDir: resolve(__dirname, "public"),
  worker: { format: "es" },
  build: { outDir: resolve(__dirname, "dist/desktop"), emptyOutDir: true, sourcemap: true, target: "esnext" },
});
