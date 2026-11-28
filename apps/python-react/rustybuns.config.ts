import { defineConfig } from "@rustybuns/cli/config";

// Desktop only: Python runs inside the Bun host, which a Cloudflare Worker can't do.
export default defineConfig({
  name: "python-react",
  source: { dir: "src", aliases: {} },
  bindings: {},
  targets: {
    desktop: {
      mode: "spa",
      clientBuild: "bunx vite build",
      clientDir: "dist/client",
      world: false,
      window: "app",
      dataDir: "~/.python-react",
      // The one thread CPython lives on, so a slow Python call never stalls the host.
      workers: ["src/python/worker.ts"],
    },
  },
});
