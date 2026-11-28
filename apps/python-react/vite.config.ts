// .rustybuns/vite.ts is written by `rustybuns build desktop`: it swaps each
// "use server" module for a proxy that calls the Bun host.
import { defineConfig } from "vite";
import { rustybuns } from "./.rustybuns/vite";

export default defineConfig({
  plugins: [rustybuns()],
  esbuild: { jsx: "automatic" },
  build: { outDir: "dist/client" },
});
