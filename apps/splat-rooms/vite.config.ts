// Plain browser build for the Cloudflare assets. There is no desktop host at the
// edge, so the "use server" scene actions become proxies that fail and the page
// shows an empty room list. .rustybuns/vite.ts comes from `rustybuns boundary`.
import { defineConfig } from "vite";
import { rustybuns } from "./.rustybuns/vite";

export default defineConfig({
  plugins: [rustybuns()],
  esbuild: { jsx: "automatic" },
  build: { target: "esnext", sourcemap: true },
});
