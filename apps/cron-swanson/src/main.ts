// Cron Swanson on a plain Bun server: `bun src/main.ts`. One process holds the page, the API, the live socket,
// the SQLite file and the ticker, so it runs the same on a laptop, under a desk or on Railway (Dockerfile,
// railway.json). Reads PORT, CRON_SWANSON_DB (default data/cron-swanson.sqlite; on Railway, a file on the mounted
// volume), CRON_SWANSON_TOKEN (the bearer token the page and scripts send; unset, the API is open) and
// CRON_SWANSON_NTFY (an ntfy topic URL reminders ping, with CRON_SWANSON_NTFY_TOKEN if that server wants one).
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import page from "./page.html";
import { serve } from "./server.ts";
import { Store } from "./store.ts";
import { delivery, startTicker, type Ntfy } from "./ticker.ts";

const file = process.env.CRON_SWANSON_DB ?? "data/cron-swanson.sqlite";
if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
const store = new Store(file);
const token = process.env.CRON_SWANSON_TOKEN || undefined;

let ntfy: Ntfy | undefined;
const topic = process.env.CRON_SWANSON_NTFY;
if (topic) {
  if (!/^https?:\/\/[^/\s]+\/\S+$/.test(topic)) throw new Error(`CRON_SWANSON_NTFY wants a topic URL like https://ntfy.sh/my-topic, not ${topic}`);
  ntfy = { url: topic, token: process.env.CRON_SWANSON_NTFY_TOKEN || undefined };
}
const send = delivery(ntfy);

const server = serve(store, {
  port: Number(process.env.PORT ?? 8790),
  routes: { "/": page },
  token,
  send,
  development: process.env.NODE_ENV !== "production",
});
startTicker(store, send);

console.log(`Cron Swanson on ${server.url} (bacron ticking each minute, ${file}${ntfy ? ", reminders ping ntfy" : ""})`);
if (!token) console.warn("CRON_SWANSON_TOKEN is unset: the API is open to anyone who can reach this port.");
