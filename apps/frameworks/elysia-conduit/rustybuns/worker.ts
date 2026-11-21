// Rusty Buns' entry for bedstack's Conduit. Their src/main.ts calls .listen(); this mounts the same
// app (setupApp, plus main.ts's redirect from /) as a fetch handler, and leaves their files alone.
//
// Their env.config.ts (arkenv) and database.providers.ts read POSTGRES_* and JWT_SECRET from
// process.env as they load, and build the postgres.js client then. So the Hyperdrive binding's
// parts go into process.env first, and their modules load after, by dynamic import.
//
// Desktop and box only. On Cloudflare this file fails at startup: a Worker can't read
// env.HYPERDRIVE at global scope, and the README lists what breaks after that.
import { env } from "cloudflare:workers";
import * as arkenvArktype from "arkenv/arktype";

// arkenv 0.9 loads its validator with createRequire(import.meta.url)("arkenv/arktype") at runtime,
// which no bundler follows: their own `bun build --compile` binary dies on it too. Bun's runtime
// plugin hands it the module the bundle already has.
Bun.plugin({ name: "arkenv-arktype", setup(b) { b.module("arkenv/arktype", () => ({ exports: arkenvArktype, loader: "object" })); } });

const pg = env.HYPERDRIVE;
if (!pg || typeof pg !== "object") throw new Error("elysia-conduit: no HYPERDRIVE binding");
const part = new Map<string, unknown>(Object.entries(pg));
for (const [name, key] of [["POSTGRES_HOST", "host"], ["POSTGRES_PORT", "port"], ["POSTGRES_USER", "user"], ["POSTGRES_PASSWORD", "password"], ["POSTGRES_DB", "database"]] as const) {
  if (part.has(key)) process.env[name] = String(part.get(key));
}
// A desktop with no JWT_SECRET set gets one per run: sign-ins last until it quits.
process.env.JWT_SECRET ||= typeof env.JWT_SECRET === "string" && env.JWT_SECRET ? env.JWT_SECRET : crypto.randomUUID();

const { Elysia } = await import("elysia");
const { setupApp } = await import("../src/app.module");

export default new Elysia().use(setupApp).get("/", ({ redirect }) => redirect("/openapi"));
