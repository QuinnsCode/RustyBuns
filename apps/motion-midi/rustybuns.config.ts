import { defineConfig } from "@rustybuns/cli/config";

export default defineConfig({
  "name": "motion-midi",
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
      "window": "app"
    }
  },
  "source": {
    "dir": "src",
    "aliases": {}
  }
});
