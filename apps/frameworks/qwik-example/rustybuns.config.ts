import { defineConfig } from "@rustybuns/cli/config";

export default defineConfig({
  "name": "qwik-example",
  "worker": {
    "main": "dist/_worker.js",
    "assets": "dist",
    "compatibilityDate": "2026-09-01",
    "compatibilityFlags": [
      "nodejs_compat"
    ],
    "build": "bunx vite build && bunx vite build -c adapters/cloudflare-pages/vite.config.ts",
    "builtMain": "dist/_worker.js"
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
