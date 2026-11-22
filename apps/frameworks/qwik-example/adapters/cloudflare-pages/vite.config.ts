// What `npm run qwik add cloudflare-pages` writes: the server build through the Cloudflare adapter.
// It builds server/entry.cloudflare-pages.js and writes dist/_worker.js (a module Worker over it)
// plus dist/_routes.json beside the client build.
import { cloudflarePagesAdapter } from "@builder.io/qwik-city/adapters/cloudflare-pages/vite";
import { extendConfig } from "@builder.io/qwik-city/vite";
import baseConfig from "../../vite.config";

export default extendConfig(baseConfig, () => {
  return {
    build: {
      ssr: true,
      rollupOptions: {
        input: ["src/entry.cloudflare-pages.tsx", "@qwik-city-plan"],
      },
    },
    plugins: [cloudflarePagesAdapter()],
  };
});
