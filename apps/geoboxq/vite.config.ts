import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [cloudflare()],
  // The Rust engine ships as a prebuilt .wasm (scripts/wasm.ts); nothing to pre-bundle.
  assetsInclude: ["**/*.wasm"],
  build: { target: "esnext" },
});
