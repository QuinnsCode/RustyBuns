import { defineConfig } from "vite";
import { redwood } from "rwsdk/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [cloudflare({ viteEnvironment: { name: "worker" } }), redwood()],
  // The Rust engine ships as a prebuilt .wasm under public/ (scripts/wasm.ts); nothing to pre-bundle.
  assetsInclude: ["**/*.wasm"],
});
