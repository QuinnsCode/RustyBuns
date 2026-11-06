import { defineConfig } from "vite";
import { redwood } from "rwsdk/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  // Qollab's Worker (apps/qollab) runs beside eqosys's, as on Cloudflare: its Hub, Party and Space, and the paths eqosys hands it.
  plugins: [cloudflare({ viteEnvironment: { name: "worker" }, auxiliaryWorkers: [{ configPath: "../qollab/wrangler.jsonc" }] }), redwood()],
  // Server-rendered pages and forms. rwsdk still builds src/client.tsx, so it holds just initClient().

});
