import { defineConfig } from "@rustybuns/cli/config";

// Qollab: eqosys's multiplayer layer as a Worker of its own (#3816, apps/eqosys/QOLLAB.md). Its code is apps/eqosys/src/qollab/;
// this Worker serves those paths (/hub, /api/hub, /q/*) and hosts the objects behind them, so friends, parties and spaces scale
// and deploy apart from sign-in. eqosys still answers on eqosys.qntbr.com and hands those paths here over a service binding,
// so no game changes a URL. Deploy order: this app first (it takes the classes, with their data, from eqosys), then eqosys.
export default defineConfig({
  name: "qollab",
  worker: {
    main: "src/worker.ts",
    compatibilityDate: "2026-09-01",
    compatibilityFlags: ["nodejs_compat"],
  },
  bindings: {
    // eqosys's database: accounts (who a token names), party seats, spaces, saves. eqosys owns it and runs its migrations.
    DB: { type: "d1", databaseName: "eqosys-db", app: "eqosys" },
    // One hub a person: friends, presence, notes. Moved here from eqosys's Worker with its data on the first deploy.
    HUB: { type: "durable_object", className: "Hub", transferredFrom: "eqosys", protect: true },
    // One party a room code: the lobby, ready, start, party chat. Lives 24 hours.
    PARTY: { type: "durable_object", className: "Party", transferredFrom: "eqosys", protect: true },
    // One space a group: its channels and their history, voice channels and who may join them.
    SPACE: { type: "durable_object", className: "Space", transferredFrom: "eqosys", protect: true },
    // The key a person's saves are sealed with. Stays in eqosys (privacy is eqosys's).
    VAULT: { type: "durable_object", className: "Vault", app: "eqosys" },
    // eqosys's own Worker, for its public keys (/.well-known/jwks.json): an app's token is checked here without the signing key.
    EQOSYS: { type: "service", app: "eqosys" },
    BETTER_AUTH_URL: { type: "var", value: "https://eqosys.qntbr.com" },
    // Signs the Qlave tickets a voice channel hands out (qollab/qlave.ts); the same 1Password item eqosys signs with. Unset, voice is off.
    EQOSYS_SIGNING_KEY: { type: "secret", op: "op://eqosys/signing-key/password", optional: true },
  },
  experimental: { wheel: "human" },
  // No domain of its own and no workers.dev URL: the only way in is eqosys's front door.
  targets: { edge: { provider: "cloudflare", workersDev: false, previewUrls: false } },
  // Beside eqosys's `--stage preview` (eqosys-preview.qntbr.com), which this stage's references find in eqosys's stack.
  stages: { preview: { bindings: { BETTER_AUTH_URL: { value: "https://eqosys-preview.qntbr.com" } } } },
});
