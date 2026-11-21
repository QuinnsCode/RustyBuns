import { defineConfig } from "@rustybuns/cli/config";

export default defineConfig({
  "name": "astro-example",
  "worker": {
    "main": "@astrojs/cloudflare/entrypoints/server",
    "assets": "dist/client",
    "compatibilityDate": "2026-09-01",
    "compatibilityFlags": [
      "nodejs_compat"
    ],
    "build": "astro build",
    "builtMain": "dist/server/entry.mjs"
  },
  "bindings": {
    "COUNTER": {
      "type": "kv"
    },
    "SESSION": {
      "type": "kv"
    }
  },
  "targets": {
    "edge": {
      "provider": "cloudflare"
    },
    "desktop": {
      "mode": "worker",
      "targets": [
        "darwin-arm64"
      ]
    }
  },
  "source": {
    "dir": "src",
    "aliases": {}
  }
});
