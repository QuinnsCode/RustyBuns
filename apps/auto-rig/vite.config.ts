// Plain browser build: `bun run dev` for hot reload. No desktop host here, so
// the "use server" action becomes a proxy that fails and the page rigs in a
// Web Worker instead. .rustybuns/vite.ts is written by `bunx rustybuns build
// desktop`: run `bun run desktop:dev` once before `bun run dev`.
import { defineConfig } from "vite";
import { rustybuns } from "./.rustybuns/vite";

export default defineConfig({
  plugins: [rustybuns()],
  esbuild: { jsx: "automatic" },
  worker: { format: "es" },
  build: { target: "esnext", sourcemap: true },
});
