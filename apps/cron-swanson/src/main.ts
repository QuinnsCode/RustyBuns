// Cron Swanson on a plain Bun server: `bun src/main.ts`. One process holds the page, the API, the SQLite file
// and the ticker, so it runs the same on a laptop, under a desk or on Railway (Dockerfile, railway.json).
// Reads PORT, CRON_SWANSON_DB (default data/cron-swanson.sqlite; on Railway, a file on the mounted volume)
// and CRON_SWANSON_TOKEN (the bearer token the page and scripts send; unset, the API is open).
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import page from "./page.html";
import { api } from "./server.ts";
import { Store } from "./store.ts";
import { startTicker } from "./ticker.ts";
import { PORTS } from "@rustybuns/util/ports";

const file = process.env.CRON_SWANSON_DB ?? "data/cron-swanson.sqlite";
if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
const store = new Store(file);
const token = process.env.CRON_SWANSON_TOKEN || undefined;

const server = Bun.serve({
  port: Number(process.env.PORT ?? PORTS.cronSwanson),
  routes: { "/": page },
  fetch: api(store, { token }),
  development: process.env.NODE_ENV !== "production",
});
startTicker(store);

console.log(`Cron Swanson on ${server.url} (bacron ticking each minute, ${file})`);
if (!token) console.warn("CRON_SWANSON_TOKEN is unset: the API is open to anyone who can reach this port.");
