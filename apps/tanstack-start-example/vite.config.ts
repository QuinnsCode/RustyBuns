import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

// TanStack Start's own Cloudflare setup, unchanged: the plugin builds the SSR environment as the Worker.
export default defineConfig({
  plugins: [cloudflare({ viteEnvironment: { name: "ssr" } }), tanstackStart(), viteReact()],
});
