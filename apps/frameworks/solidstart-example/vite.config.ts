// As SolidStart 2's template writes it (a Vite plugin, Nitro behind it), with Nitro's Cloudflare
// module preset: the build is a module Worker in .output/server/index.mjs and its static files
// in .output/public, which `wrangler.jsonc` points at.
import { solidStart } from "@solidjs/start/config";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [solidStart(), nitro({ preset: "cloudflare_module" })],
  // `cloudflare:workers` is the runtime's, not a package: leave it as an import in the Worker.
  environments: { ssr: { build: { rolldownOptions: { external: [/^cloudflare:/] } } } },
});
