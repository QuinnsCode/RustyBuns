import { defineConfig } from "@rustybuns/cli/config";

export default defineConfig({
  "name": "hono-example",
  "worker": {
    "main": "src/index.ts",
    "compatibilityDate": "2026-09-01",
    "compatibilityFlags": [
      "nodejs_compat"
    ]
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
    "dir": "src",
    "aliases": {}
  }
});
