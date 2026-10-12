import { defineConfig } from "vite";
import { redwood } from "rwsdk/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// No remote bindings in dev: Workers AI would bill, and dev fights are free practice anyway.
export default defineConfig({
  plugins: [cloudflare({ viteEnvironment: { name: "worker" }, remoteBindings: false }), redwood()],
});
