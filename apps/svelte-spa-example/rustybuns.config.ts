import { defineConfig } from "@rustybuns/cli/config";

export default defineConfig({
  "name": "svelte-spa-example",
  "source": {
    "dir": "src",
    "aliases": {}
  },
  "worker": {
    "assets": "dist/web",
    "compatibilityDate": "2026-10-28",
    "compatibilityFlags": [],
    "build": "bunx vite build --outDir dist/web --emptyOutDir",
    "notFoundHandling": "single-page-application"
  },
  "bindings": {},
  "targets": {
    "edge": {
      "provider": "cloudflare"
    },
    "desktop": {
      "mode": "spa",
      "clientBuild": "bunx vite build --outDir dist/ui --emptyOutDir",
      "clientDir": "dist/ui",
      "world": false,
      "host": "desktop/host.ts",
      "targets": [
        "darwin-arm64"
      ]
    }
  }
});
