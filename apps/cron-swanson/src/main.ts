// Cron Swanson on a plain Bun server: `bun src/main.ts`. One process holds the page, the API, the SQLite file
// and the ticker, so it runs the same on a laptop, under a desk or on Railway (Dockerfile, railway.json).
// Reads PORT, CRON_SWANSON_DB (default data/cron-swanson.sqlite; on Railway, a file on the mounted volume),
// CRON_SWANSON_OWNER (the email of the one eqosys account the page lets in; EQOSYS_URL says which eqosys, the live one
// unless set) and CRON_SWANSON_TOKEN (the bearer scripts and apps send, and the relay's secret). With neither of the
// two set, the API is open.
// CRON_SWANSON_RELAY (the relay Worker's URL, relay.ts) makes pages live: the server nudges it after each change.
// CRON_SWANSON_NTFY (an ntfy topic URL) pings the phone when a reminder fires.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { TokenChecker } from "@rustybuns/util/token";
import page from "./page.html";
import { APP, EQOSYS } from "./api.ts";
import { api } from "./server.ts";
import { Store } from "./store.ts";
import { deliver, startTicker, withPush } from "./ticker.ts";
import { relay } from "./live.ts";
import { PORTS } from "@rustybuns/util/ports";

const file = process.env.CRON_SWANSON_DB ?? "data/cron-swanson.sqlite";
if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
const store = new Store(file);
const token = process.env.CRON_SWANSON_TOKEN || undefined;
const email = process.env.CRON_SWANSON_OWNER?.trim() || undefined;
const owner = email ? { email, checker: new TokenChecker((process.env.EQOSYS_URL || EQOSYS).replace(/\/$/, ""), APP) } : undefined;
const relayUrl = process.env.CRON_SWANSON_RELAY || undefined;
const live = relayUrl ? relay(relayUrl, token) : null;
const topic = process.env.CRON_SWANSON_NTFY || undefined;
const send = topic ? withPush(deliver, topic) : deliver;
const changed = live ? () => live.poke() : undefined;

const server = Bun.serve({
  port: Number(process.env.PORT ?? PORTS.cronSwanson),
  routes: { "/": page },
  fetch: api(store, { send, ...(token && { token }), ...(owner && { owner }), ...(changed && { changed }), ...(relayUrl && { live: new URL("/live", relayUrl.replace(/^http/, "ws")).href }) }),
  development: process.env.NODE_ENV !== "production",
});
startTicker(store, send, console.error, changed);

console.log(`Cron Swanson on ${server.url} (bacron ticking each minute, ${file})`);
if (owner) console.log(`The page signs in through ${owner.checker.eqosys} and lets in ${owner.email} only.`);
if (relayUrl) console.log(`Pages go live through ${relayUrl}`);
if (topic) console.log("Reminders push to the ntfy topic in CRON_SWANSON_NTFY.");
if (!token && !owner) console.warn("CRON_SWANSON_OWNER and CRON_SWANSON_TOKEN are unset: the API is open to anyone who can reach this port.");
else if (!owner) console.warn("CRON_SWANSON_OWNER is unset: only callers with CRON_SWANSON_TOKEN get in, so the page can't sign in.");
