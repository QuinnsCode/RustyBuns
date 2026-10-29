import { defineConfig } from "vite";
import { redwood } from "rwsdk/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [cloudflare({ viteEnvironment: { name: "worker" } }), redwood()],
  // Server-rendered pages and forms. rwsdk still builds src/client.tsx, so it holds just initClient().

});
