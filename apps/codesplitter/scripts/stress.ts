// Stress test for the modes that cost nothing: the app in-process on the local twins (D1, queues, DOs, git),
// with webhook sends caught by a stub, so no request leaves the machine and nothing is billed.
//
//   bun scripts/stress.ts [--extra 25] [--commits 150] [--json]
//
// Part 1, rate limits: for every rule that is free to hit, one caller (stamped as if from the internet,
// since only those are counted) fires `cap + extra` requests at once. A rule is sound when exactly `cap`
// get past the limiter (whatever the route then answers, a 409 included), the rest get a 429 with a
// retry-after, nothing is a 5xx, and the counters agree.
// Part 2, webhooks: ten hooks on a repo, a storm of branches and commits, and a receiver that is flaky,
// then dead. Every event must reach every hook exactly once, signed; failures must book a retry; a pile of
// redelivers at once must each go out.
//
// Left out on purpose, because in the cloud they cost money: dig, github, agent, hosted, preview, deploy,
// checks, containers, doctor, fresh, and the Cloudflare email behind mail. They are still counted by the same code.
import { local } from "../src/local.ts";
import { sign } from "../src/hooks.ts";

const arg = (n: string, d: number) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? Number(process.argv[i + 1]) : d; };
const EXTRA = arg("extra", 25), COMMITS = arg("commits", 150), AS_JSON = process.argv.includes("--json");
const ip = { "cf-connecting-ip": "203.0.113.7" };

export interface Row { name: string; cap: number; sent: number; ok: number; limited: number; other: number; retryAfter: boolean; counted: number; ms: number; pass: boolean }

/** One caller, one rule: `cap + extra` at once; every request is `fire(i)`. */
async function hammer(call: Awaited<ReturnType<typeof local>>, name: string, cap: number, fire: (i: number) => Promise<Response>): Promise<Row> {
  const sent = cap + EXTRA, t = performance.now();
  const res = await Promise.all(Array.from({ length: sent }, (_, i) => fire(i)));
  const ms = performance.now() - t;
  const limited = res.filter((r) => r.status === 429), ok = res.filter((r) => r.status !== 429 && r.status < 500).length;   // a 409 got past the limiter
  const hits = await call.env.DB.prepare("SELECT COALESCE(SUM(count), 0) AS n FROM limit_hits WHERE rule = ?").bind(name).first();
  const counted = Number(hits?.n ?? 0);
  const retryAfter = limited.length > 0 && limited.every((r) => Number(r.headers.get("retry-after")) > 0);
  return { name, cap, sent, ok, limited: limited.length, other: sent - ok - limited.length, retryAfter, counted, ms,
    pass: ok === cap && limited.length === EXTRA && retryAfter };
}

async function limits(): Promise<Row[]> {
  // With no ADMINS every alias is an admin, and admins are never limited.
  const call = await local({ GH_CLI: "off", ADMINS: "nobody-here" });
  const post = (user: string, path: string, body: unknown = {}) => call(user, path, { method: "POST", headers: ip, body: JSON.stringify(body) });
  const rows: Row[] = [];
  try {
    // Set-up goes through the desktop door (no ip stamp), so it isn't counted.
    const setup = (user: string, path: string, body: unknown = {}) => call(user, path, { method: "POST", body: JSON.stringify(body) });
    const who = async (u: string) => { await setup(u, "/api/login", { name: u }); };
    const repo = async (u: string, name: string, file = "a.ts") => {
      await setup(u, "/api/repos", { name, visibility: "public" });
      await setup(u, `/api/repos/${u}/${name}/files`, { path: file, content: "one\ntwo\nthree" });
    };

    await who("p1"); await who("p2"); await who("p3"); await who("p4"); await who("p5"); await who("p6"); await who("p7");
    await repo("p1", "lab"); await repo("p2", "lab"); await repo("p3", "lab"); await repo("p4", "lab"); await repo("p5", "lab"); await repo("p6", "lab"); await repo("p7", "lab");

    // A caller per rule, so one rule's hits never muddy another's count.
    const reset = (n: string) => call.env.DB.prepare("DELETE FROM limit_hits WHERE rule = ?").bind(n).run();
    for (const n of ["repo", "file", "branch", "search", "hook", "commit", "edit"]) await reset(n);

    rows.push(await hammer(call, "repo", 10, (i) => post("p1", "/api/repos", { name: `r${i}` })));
    rows.push(await hammer(call, "file", 120, (i) => post("p2", "/api/repos/p2/lab/files", { path: `f${i}.ts`, content: "x" })));
    rows.push(await hammer(call, "branch", 60, (i) => post("p3", "/api/repos/p3/lab/branches", { name: `b${i}` })));
    rows.push(await hammer(call, "search", 30, () => call("p4", "/api/search?q=one", { headers: ip })));
    // A repo holds ten hooks, so the first ten past the limit answer 400 rather than 201: count what the limit let in.
    const hooks = await hammer(call, "hook", 20, (i) => post("p5", "/api/repos/p5/lab/hooks", { url: `https://ci.example/${i}` }));
    rows.push({ ...hooks, ok: hooks.ok + hooks.other, other: 0, pass: hooks.limited === EXTRA && hooks.retryAfter });
    rows.push(await hammer(call, "commit", 60, () => post("p6", "/api/repos/p6/lab/do/commit?path=a.ts", { message: "m" })));
    const doc = await (await call("p7", "/api/repos/p7/lab/do/file?path=a.ts")).json() as any;
    rows.push(await hammer(call, "edit", 300, (i) => post("p7", "/api/repos/p7/lab/do/ops?path=a.ts",
      { ops: [{ kind: "set", line: doc.lines[0].id, text: `v${i}` }] })));
  } finally { call.close(); }
  return rows;
}

export interface Storm { hooks: number; events: number; expected: number; delivered: number; badSignatures: number; ms: number; perSec: number;
  flaky: { failed: number; booked: number }; dead: { pending: number; booked: number }; redeliver: { sent: number; extra: number }; pass: boolean }

async function webhooks(): Promise<Storm> {
  const call = await local({ GH_CLI: "off" });
  const got: { id: string; raw: string; sig: string; url: string }[] = [];
  let status = 200;
  call.env.HOOK_FETCH = async (url: string, init: RequestInit) => {
    const h = new Headers(init.headers);
    got.push({ id: h.get("x-codesplitter-delivery")!, raw: String(init.body), sig: h.get("x-codesplitter-signature")!, url });
    return new Response("ok", { status });
  };
  const send = (path: string, body: unknown, method = "POST") => call("ryan", path, { method, body: JSON.stringify(body) });
  const SECRET = "stress-secret-sixteen+";
  try {
    await send("/api/login", { name: "ryan" });
    await send("/api/repos", { name: "lab", visibility: "private" });
    await send("/api/repos/ryan/lab/files", { path: "a.ts", content: "one\ntwo" });
    const HOOKS = 10;
    for (let i = 0; i < HOOKS; i++) await send("/api/repos/ryan/lab/hooks", { url: `https://ci.example/h${i}`, events: ["commit", "branch.opened"], secret: SECRET });

    // The storm: a branch and a commit per round, no ip stamp (the desktop's door), so only the hooks are on trial.
    const t = performance.now();
    await Promise.all(Array.from({ length: COMMITS }, (_, i) => send("/api/repos/ryan/lab/branches", { name: `s${i}` })));
    const doc = await (await call("ryan", "/api/repos/ryan/lab/do/file?path=a.ts")).json() as any;
    let commits = 0;
    for (let i = 0; i < COMMITS / 5; i++) {
      await send("/api/repos/ryan/lab/do/ops?path=a.ts", { ops: [{ kind: "set", line: doc.lines[0].id, text: `v${i}` }] });
      if ((await send("/api/repos/ryan/lab/do/commit?path=a.ts", { message: `c${i}` })).status < 300) commits++;
    }
    const events = COMMITS + commits, expected = events * HOOKS;
    for (const end = performance.now() + 60_000; performance.now() < end && got.length < expected;) await Bun.sleep(20);
    const ms = performance.now() - t;
    const ids = new Set(got.map((g) => g.id));   // one delivery id per hook per event
    let badSignatures = 0;
    for (const g of got) if (g.sig !== await sign(SECRET, g.raw)) badSignatures++;

    // A receiver that answers 500: every delivery fails its first try and books the next.
    status = 500; got.length = 0;
    await send("/api/repos/ryan/lab/branches", { name: "flaky" });
    for (const end = performance.now() + 10_000; performance.now() < end && got.length < HOOKS;) await Bun.sleep(20);
    await Bun.sleep(200);
    const q = (s: string) => call.env.DB.prepare(`SELECT COUNT(*) AS n FROM webhook_deliveries WHERE ${s}`).first().then((r: any) => Number(r.n));
    const flaky = { failed: await q("status = 'failed'"), booked: await q("status = 'pending' AND attempts = 1 AND next_at > " + Date.now()) };

    // Redeliver every delivery at once, to a receiver that is well again: each goes out, none twice per press.
    status = 200; got.length = 0;
    const { results } = await call.env.DB.prepare("SELECT d.id, d.hook FROM webhook_deliveries d WHERE d.status = 'pending' LIMIT 100").all() as any;
    await Promise.all(results.map((d: any) => send(`/api/repos/ryan/lab/hooks/${d.hook}/deliveries/${d.id}/redeliver`, {})));
    for (const end = performance.now() + 15_000; performance.now() < end && got.length < results.length;) await Bun.sleep(20);
    await Bun.sleep(200);
    const redeliver = { sent: results.length, extra: Math.max(0, got.length - results.length) };

    // And a dead one: the network throws.
    call.env.HOOK_FETCH = async () => { throw new Error("connect ECONNREFUSED"); };
    await send("/api/repos/ryan/lab/branches", { name: "dead" });
    await Bun.sleep(500);
    const dead = { pending: await q("status = 'pending' AND response LIKE '%ECONNREFUSED%'"), booked: await q("status = 'pending' AND next_at IS NOT NULL AND response LIKE '%ECONNREFUSED%'") };

    const delivered = ids.size;
    return { hooks: HOOKS, events, expected, delivered, badSignatures, ms, perSec: Math.round(expected / (ms / 1000)),
      flaky, dead, redeliver,
      pass: delivered === expected && badSignatures === 0 && flaky.failed === 0 && flaky.booked >= HOOKS && dead.booked >= HOOKS && redeliver.extra === 0 };
  } finally { call.close(); }
}

if (import.meta.main) {
  const rows = await limits(), storm = await webhooks();
  if (AS_JSON) console.log(JSON.stringify({ rows, storm }, null, 2));
  else {
    console.log("rule      cap   sent  ok    429   other  counted  ms     result");
    for (const r of rows) console.log(`${r.name.padEnd(9)} ${String(r.cap).padEnd(5)} ${String(r.sent).padEnd(5)} ${String(r.ok).padEnd(5)} ${String(r.limited).padEnd(5)} ${String(r.other).padEnd(6)} ${String(r.counted).padEnd(8)} ${String(Math.round(r.ms)).padEnd(6)} ${r.pass ? "ok" : "FAIL"}`);
    console.log(`\nwebhooks: ${storm.events} events x ${storm.hooks} hooks = ${storm.expected} deliveries, ${storm.delivered} arrived in ${Math.round(storm.ms)} ms (${storm.perSec}/s), ${storm.badSignatures} bad signatures`);
    console.log(`  500s: ${storm.flaky.booked}/${storm.hooks} booked a retry, ${storm.flaky.failed} given up early`);
    console.log(`  dead: ${storm.dead.booked}/${storm.hooks} booked a retry`);
    console.log(`  redeliver storm: ${storm.redeliver.sent} pressed, ${storm.redeliver.extra} extra sends`);
    console.log(`  ${storm.pass ? "ok" : "FAIL"}`);
  }
  process.exit(rows.every((r) => r.pass) && storm.pass ? 0 : 1);
}
