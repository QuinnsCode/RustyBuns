import { defineConfig } from "@rustybuns/cli/config";

export default defineConfig({
  "name": "splat-rooms",
  "worker": {
    "main": "src/worker.ts",
    "builtMain": "dist/worker/worker.js",
    "assets": "dist/client",
    "compatibilityDate": "2025-05-07",
    "compatibilityFlags": [
      "nodejs_compat"
    ],
    "build": "vite build --outDir dist/client"
  },
  "bindings": {},
  "targets": {
    "edge": {
      "provider": "cloudflare"
    },
    "desktop": {
      "mode": "spa",
      "clientBuild": "bunx vite build --config vite.desktop.config.ts",
      "clientDir": "dist/desktop",
      "world": "packages/desktop/world.ts",
      "worldPath": "/ws",
      "targets": [
        "linux-x64"
      ],
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
