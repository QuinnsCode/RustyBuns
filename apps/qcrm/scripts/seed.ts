// Seed an org with made-up contacts, companies, deals and activities.
//
//   bun scripts/seed.ts                         100,000 contacts into a fresh in-memory org; prints the timing (a benchmark)
//   bun scripts/seed.ts --n 5000                fewer
//   bun scripts/seed.ts --url http://127.0.0.1:5173 --org org_… --cookie "better-auth.session_token=…" [--n 100000]
//                                               a running app (dev server, the desktop or production), as an owner
//
// The rows are deterministic (src/seed-data.ts, seed 7), so two runs look the same and a demo is reproducible.
import { parseArgs } from "node:util";

const { values: a } = parseArgs({ options: { n: { type: "string", default: "100000" }, url: { type: "string" }, org: { type: "string" }, cookie: { type: "string" } } });
const n = Math.min(100_000, Math.max(1, Number(a.n) || 100_000));

if (a.url) {
  if (!a.org || !a.cookie) { console.error("--url needs --org and --cookie (an owner's session cookie)"); process.exit(2); }
  const t = performance.now();
  const res = await fetch(`${a.url.replace(/\/$/, "")}/api/orgs/${a.org}/seed`, { method: "POST", headers: { "content-type": "application/json", cookie: a.cookie, origin: new URL(a.url).origin }, body: JSON.stringify({ n }) });
  console.log(res.status, await res.text(), `${Math.round(performance.now() - t)} ms`);
  process.exit(res.ok ? 0 : 1);
}

const { local } = await import("../src/local.ts");
const { seedOrg } = await import("../src/seed-data.ts");
const app = await local();
const t = performance.now();
const result = await seedOrg(app.env, "org_bench", "bench-user", n);
const ms = Math.round(performance.now() - t);
const count = await app.env.DB.prepare("SELECT count(*) AS c FROM contacts WHERE org_id = ?").bind("org_bench").first<{ c: number }>();
console.log(JSON.stringify({ n, ms, perRow: +(ms / n).toFixed(3), contacts: count?.c, ...(typeof result === "object" ? result : {}) }));
app.close();
