import { defineConfig } from "vite";
import { redwood } from "rwsdk/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// Dev fights are free practice on random answers, with no remote bindings. EXCALIBRAWL_REAL_AI=1 connects the
// real Workers AI (billed, ~$0.02 a fight, through your wrangler login) to see how Clef actually draws.
const real = process.env.EXCALIBRAWL_REAL_AI === "1";

export default defineConfig({
  define: { "import.meta.env.VITE_REAL_AI": JSON.stringify(real) },
  plugins: [cloudflare({ viteEnvironment: { name: "worker" }, remoteBindings: real }), redwood()],
});
