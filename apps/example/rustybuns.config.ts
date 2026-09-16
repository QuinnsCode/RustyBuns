import { defineConfig } from "@rustybuns/cli/config";

export default defineConfig({
  "name": "druids-curse",
  "worker": {
    "main": "src/worker.tsx",
    "builtMain": "dist/worker/worker.js",
    "assets": "dist/client",
    "compatibilityDate": "2026-06-01",
    "compatibilityFlags": [
      "nodejs_compat"
    ],
    "build": "bun run build.ts"
  },
  "bindings": {
    "DB": {
      "type": "d1",
      "databaseName": "druids-curse-db",
      "migrationsDir": "migrations"
    },
    "PRESENCE_KV": {
      "type": "kv"
    },
    "WORLD_DURABLE_OBJECT": {
      "type": "durable_object",
      "className": "WorldDurableObject"
    },
    "DEBUG_DIRECTOR_USERS": {
      "type": "var",
      "value": ""
    }
  },
  "targets": {
    "edge": {
      "provider": "cloudflare"
    },
    "desktop": {
      "window": "app"
    }
  }
});
