import { defineConfig } from "@rustybuns/cli/config";

export default defineConfig({
  "name": "nextjs-example",
  "worker": {
    "main": ".open-next/worker.js",
    "assets": ".open-next/assets",
    "compatibilityDate": "2026-09-01",
    "compatibilityFlags": [
      "nodejs_compat"
    ],
    "build": "bunx opennextjs-cloudflare build",
    "builtMain": ".open-next/worker.js"
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
