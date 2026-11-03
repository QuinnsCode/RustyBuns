import { defineConfig } from "@rustybuns/cli/config";

export default defineConfig({
  "name": "splat-rooms",
  "worker": {
    "main": "src/worker.ts",
    "assets": "dist/client",
    "compatibilityDate": "2025-05-07",
    "compatibilityFlags": [
      "nodejs_compat"
    ],
    "build": "bun run build"
  },
  "bindings": {},
  "targets": {
    "edge": {
      "provider": "cloudflare",
      // The URL is splat-rooms.<subdomain>.workers.dev, which eqosys knows as this app's origin.
      "adopt": true,
      "workerName": "splat-rooms"
    },
    "desktop": {
      "mode": "spa",
      "clientBuild": "bunx vite build --config vite.desktop.config.ts",
      "clientDir": "dist/desktop",
      "world": "packages/desktop/world.ts",
      "worldPath": "/ws",
      "window": "app",
      // Scene folders live on the user's disk, so this mount is read where it
      // is and never embedded in the binary. Override with SPLAT_ROOMS_DIR.
      "mounts": { "/scenes": "~/Documents/SplatRooms" }
    }
  },
  "source": {
    "dir": "src",
    "aliases": {}
  }
});
