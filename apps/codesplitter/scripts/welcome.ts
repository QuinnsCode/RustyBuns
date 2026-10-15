#!/usr/bin/env bun
// The welcome tour: the first five minutes of Rusty Buns, on the local twins (nothing leaves the machine, nothing
// is billed). It digs up apps/hello-world, lets three agents rewrite it at once (the firehose), shows what Mervin
// and Ester do about it, then asks "but wait, we have your code here: why not deploy it?" and answers with the
// repo's own fit verdict and deploy plan. The last chapter prints the commands for planning, building and shipping
// to the web and the desktop, which stay yours to run.
//
//   bun run welcome [--port 4747] [--rounds 3] [--pace 500] [--wait 20] [--no-serve]
//   bun run welcome --box      an ephemeral box: serves the app with hello-world dug up and waits for an agent to drive it
//
// Open the printed link first: the firehose glow and the shimmering claims are on the file page.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { local } from "../src/local.ts";

const FILE = "src/greeting.ts";
const APP = join(import.meta.dir, "../../hello-world");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The app's source files as {path: text}: what "digging it up" brings in. */
export function appFiles(dir = APP) {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
      const p = join(d, name);
      statSync(p).isDirectory() ? walk(p) : (out[relative(dir, p)] = readFileSync(p, "utf8"));
    }
  };
  walk(dir);
  return out;
}

/** What each agent does to its own block of src/greeting.ts. */
const JOBS = [
  { who: "agent-ada", marker: "// Greeting", task: "warm up the greeting", add: "// ada: greets by name" },
  { who: "agent-bo", marker: "// Theme", task: "try a new accent colour", add: "// bo: the accent is brand orange" },
  { who: "agent-cy", marker: "// Footer", task: "reword the footer", add: "// cy: footer says who built it" },
];

export interface Tour { say(who: string, what: string): void; pace: number; rounds: number; stopAfterDig?: boolean; }

export async function tour(call: Awaited<ReturnType<typeof local>>, t: Tour) {
  const j = (user: string, path: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
    call(user, "/api" + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const ok = async (r: Response | Promise<Response>, what: string) => {
    const res = await r;
    if (!res.ok) throw new Error(`${what}: ${res.status} ${await res.text()}`);
    return res;
  };
  const base = "/repos/ryan/hello-world", at = `${base}/do`, q = (b?: string) => `?path=${encodeURIComponent(FILE)}${b ? `&branch=${b}` : ""}`;
  type Line = { id: string; text: string; rev: number; by: string };
  const read = async (b?: string) => ((await (await ok(j("ryan", `${at}/file${q(b)}`), "read")).json()) as { lines: Line[] }).lines;
  const block = async (marker: string) => {
    const ls = await read(), i = ls.findIndex((l) => l.text === marker), n = ls.slice(i).findIndex((l) => l.text === "");
    return ls.slice(i + 1, n < 0 ? undefined : i + n);
  };

  // 1. Dig it up.
  t.say("1 dig", "digging up apps/hello-world");
  await ok(j("ryan", "/login", { name: "ryan" }), "login");
  await ok(j("ryan", "/repos", { name: "hello-world", visibility: "public" }), "create repo");
  const files = appFiles();
  for (const [path, content] of Object.entries(files)) await ok(j("ryan", `${base}/files`, { path, content }), `add ${path}`);
  for (const a of JOBS) await ok(j("ryan", `${base}/collaborators`, { name: a.who }), `invite ${a.who}`);
  t.say("1 dig", `${Object.keys(files).length} files, ${(await read()).length} lines in ${FILE}, every line with an id and an author`);

  if (t.stopAfterDig) return { landed: 0, held: 0, waves: 0, conflicted: false };

  // 2. The firehose: three agents, one file, same moment.
  t.say("2 firehose", "three agents claim a block each and rewrite it line by line");
  let landed = 0, held = 0;
  const work = async (job: (typeof JOBS)[number], round: number) => {
    const lines = await block(job.marker);
    const claim = (await (await ok(j(job.who, `${at}/claims${q()}`, { id: `run-${job.who.slice(6)}-${round}`, task: job.task, lines: lines.map((l) => l.id) }), "claim")).json()) as { id: string };
    for (const l of lines) {
      await sleep(t.pace + Math.random() * t.pace);
      const cur = (await read()).find((x) => x.id === l.id)!;
      const r = await j(job.who, `${at}/ops${q()}`, { claim: claim.id, ops: [{ kind: "set", line: l.id, base: cur.rev, text: cur.text.replace(/ \/\/ r\d+$/, "") + ` // r${round}` }] });
      r.ok ? landed++ : held++;
      t.say(job.who, r.ok ? `rewrote ${l.text.trim().slice(0, 40)}` : `refused (${r.status})`);
    }
    await ok(j(job.who, `${at}/ops${q()}`, { claim: claim.id, ops: [{ kind: "insert", after: lines.at(-1)!.id, text: `${job.add} (r${round})` }] }), "insert");
    landed++;
    await ok(j(job.who, `${at}/release${q()}`, { id: claim.id }), "release");
  };
  for (let round = 1; round <= t.rounds; round++) {
    const runs = JOBS.map((job, i) => sleep(i * t.pace).then(() => work(job, round)));
    // Ada reaches for bo's lines while bo holds them: held, not clobbered.
    await sleep(t.pace * 2);
    const theme = await block("// Theme"), cur = (await read()).find((l) => l.id === theme[0]!.id)!;
    const r = await j("agent-ada", `${at}/ops${q()}`, { ops: [{ kind: "set", line: cur.id, base: cur.rev, text: cur.text + " // ada was here" }] });
    if (r.status === 409) held++;
    t.say("agent-ada", r.status === 409 ? "reached for bo's lines: 409, held" : `reached for bo's lines: ${r.status}`);
    await Promise.all(runs);
  }
  t.say("2 firehose", `${landed} edits landed, ${held} refused instead of overwritten, nobody waited on a lock`);

  // 3. Mervin (merge) and Ester (tests) keep it from becoming a mess.
  t.say("3 mervin", "two branches rewrite the same greeting line");
  const target = (await block("// Greeting")).find((l) => l.text.includes("return"))!;
  for (const b of ["warmer", "shorter"]) await ok(j("ryan", `${base}/branches`, { name: b }), `branch ${b}`);
  const fresh = (await read()).find((l) => l.id === target.id)!;
  const edit = (b: string, text: string) => ok(j("ryan", `${at}/ops${q(b)}`, { ops: [{ kind: "set", line: target.id, base: fresh.rev, text }] }), `edit ${b}`);
  await edit("warmer", "  return `Hello there, ${name}!`;");
  await edit("shorter", "  return `Hi ${name}`;");
  const plan = (await (await ok(j("ryan", `${base}/merge-plan`), "merge plan")).json()) as { engine: string; waves: unknown[][] };
  t.say("3 mervin", `${plan.engine} plans ${plan.waves.length} waves before anyone merges: the clashing branch waits its turn`);
  await ok(j("ryan", `${base}/branches/warmer/merge`, {}), "merge warmer");
  const card = await j("ryan", `${base}/branches/shorter/merge`, {});
  t.say("3 mervin", card.status === 409 ? "the second branch gets a conflict card with both sides, no tokens spent" : `second merge answered ${card.status}`);
  await ok(j("ryan", `${base}/branches/shorter/merge`, { resolve: { [FILE]: { [target.id]: "branch" } } }), "settle the conflict");
  t.say("3 ester", "Ester the tester sorts any red test by owner (main, flaky, or the PR that broke it) so Mervin only waits on real blockers: bun apps/codesplitter/scripts/ester.ts");

  // 4. But wait: we have your code here.
  t.say("4 deploy", "but wait, we have your code here. Why not just deploy it?");
  const fit = (await (await ok(j("ryan", `${base}/fit`), "fit")).json()) as { verdict?: string; fit?: string; reasons?: string[] };
  t.say("4 deploy", `Rusty Buns reads the repo: ${fit.verdict ?? fit.fit ?? "unknown"}${fit.reasons?.length ? ` (${fit.reasons.slice(0, 2).join("; ")})` : ""}`);
  t.say("4 deploy", "deploys refuse without a plan for this exact config, list what bills you, and only a person presses the button");

  // 5. Plan, build, web and desktop.
  for (const line of [
    "5 next: cd apps/hello-world",
    "  bun run dev                       the web app, hot reload",
    "  bun run desktop:dev               the desktop app",
    "  bunx rustybuns plan               what a Cloudflare deploy would create; creates nothing",
    "  bunx rustybuns deploy             the real thing, after you read the plan",
  ]) t.say("tour", line);
  return { landed, held, waves: plan.waves.length, conflicted: card.status === 409 };
}

if (import.meta.main) {
  const arg = (n: string, d: number) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? Number(process.argv[i + 1]) : d; };
  const PORT = arg("port", 4747), WAIT = arg("wait", 20);
  const call = await local({ GH_CLI: "off" });
  const box = process.argv.includes("--box");
  if (!process.argv.includes("--no-serve")) {
    const { serve } = await import("@rustybuns/shell-bun");
    const { default: worker } = await import("../src/worker.ts");
    if (!(await Bun.file("dist/client/index.html").exists())) await Bun.$`bun run build.ts`.quiet();
    const shell = serve({ port: PORT, assets: "dist/client", runWorkerFirst: ["/api"], reporter: { escaped: (...a: unknown[]) => console.error("[server]", ...a) } as any });
    shell.mount(worker as any, call.env);
    console.log(`\nOpen: ${shell.url}/#/r/ryan/hello-world\n(sign in as "ryan" first: run  document.cookie = "cs_user=ryan; path=/"  in the page console, then reload)`);
    if (box) console.log(`Box up on ${shell.url}: sign in as ryan, API at ${shell.url}/api, MCP at ${shell.url}/api/mcp. Nothing runs until an agent does it.`);
    else {
      console.log(`Then open ${FILE}. The tour starts in ${WAIT}s.\n`);
      await sleep(WAIT * 1000);
    }
  }
  await tour(call, { pace: arg("pace", 500), rounds: arg("rounds", 3), stopAfterDig: box, say: (who, what) => console.log(`${new Date().toISOString().slice(11, 19)}  ${who.padEnd(10)} ${what}`) });
  if (!process.argv.includes("--no-serve")) { console.log("\nCtrl-C to stop the server"); await new Promise(() => {}); }
  call.close();
}
