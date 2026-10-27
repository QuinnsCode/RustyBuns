import { defineConfig } from "@rustybuns/cli/config";

export default defineConfig({
  "name": "react-router-example",
  "worker": {
    "main": "./workers/app.ts",
    "builtMain": "build/server/index.js",
    "assets": "build/client",
    "compatibilityDate": "2026-09-01",
    "compatibilityFlags": [
      "nodejs_compat"
    ],
    "build": "react-router build"
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
