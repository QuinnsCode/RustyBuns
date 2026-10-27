import { defineConfig } from "@rustybuns/cli/config";

export default defineConfig({
  "name": "sveltekit-example",
  "worker": {
    "main": ".svelte-kit/cloudflare/_worker.js",
    "assets": ".svelte-kit/cloudflare",
    "compatibilityDate": "2026-09-01",
    "compatibilityFlags": [
      "nodejs_compat"
    ],
    "build": "vite build",
    "builtMain": ".svelte-kit/cloudflare/_worker.js"
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
