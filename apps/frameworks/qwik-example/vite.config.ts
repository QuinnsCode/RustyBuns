// Qwik City's vite config as `npm create qwik` writes it, minus the starter extras (tsconfig paths, dev-only tweaks).
import { defineConfig } from "vite";
import { qwikVite } from "@builder.io/qwik/optimizer";
import { qwikCity } from "@builder.io/qwik-city/vite";

export default defineConfig(() => ({
  plugins: [qwikCity(), qwikVite()],
}));
