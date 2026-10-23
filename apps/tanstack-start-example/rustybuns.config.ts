import { defineConfig } from "@rustybuns/cli/config";

export default defineConfig({
  "name": "tanstack-start-example",
  "worker": {
    "main": "@tanstack/react-start/server-entry",
    "builtMain": "dist/server/index.js",
    "assets": "dist/client",
    "compatibilityDate": "2026-09-01",
    "compatibilityFlags": [
      "nodejs_compat"
    ],
    "build": "vite build"
  },
  "bindings": {
    "DB": {
      "type": "d1",
      "databaseName": "tanstack-start-example-db",
      "migrationsDir": "migrations"
    },
    "VISITS": {
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
