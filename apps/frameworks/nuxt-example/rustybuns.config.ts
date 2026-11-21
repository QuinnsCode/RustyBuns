import { defineConfig } from "@rustybuns/cli/config";

export default defineConfig({
  "name": "nuxt-example",
  "worker": {
    "main": ".output/server/index.mjs",
    "assets": ".output/public",
    "compatibilityDate": "2026-09-01",
    "compatibilityFlags": [
      "nodejs_compat"
    ],
    "build": "nuxt build",
    "builtMain": ".output/server/index.mjs"
  },
  "bindings": {
    "COUNTER": {
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
    "dir": "app",
    "aliases": {}
  }
});
