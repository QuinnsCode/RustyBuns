// Plain browser build: `bun run dev` for hot reload. No desktop host here, so the "use server"
// action becomes a proxy that fails and only the tab lanes race. .rustybuns/vite.ts is written by
// `bunx rustybuns build desktop`: run `bun run desktop:dev` once before `bun run dev`.
// SharedArrayBuffer needs cross-origin isolation, so dev and preview send the headers that
// public/_headers sends on Cloudflare (and the desktop host sends by default).
import { defineConfig } from "vite";
import { rustybuns } from "./.rustybuns/vite";

const isolation = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };
export default defineConfig({
  plugins: [rustybuns()],
  server: { headers: isolation },
  preview: { headers: isolation },
  // The face worker calls the host's face action itself (src/faces/face-worker.ts), so workers get the proxies too.
  worker: { format: "es", plugins: () => [rustybuns()] },
  // Pre-bundling moves ONNX Runtime away from its .wasm, which it finds next to itself (src/faces/run.ts).
  optimizeDeps: { exclude: ["onnxruntime-web"] },
  build: { target: "esnext", sourcemap: true },
});
