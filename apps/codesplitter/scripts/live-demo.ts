#!/usr/bin/env bun
// Watch agents edit one file together, live. Boots the app in-process on the local twins (nothing leaves the
// machine, nothing is billed), serves it on a port, and plays three coding agents through the same API a real
// one uses: claim a block of lines, rewrite it line by line, hand the lines back. Open the file in a browser
// and the edits stream in over the file's WebSocket as they land.
//
//   bun scripts/live-demo.ts [--port 4747] [--rounds 3] [--pace 700] [--wait 20]
//
// What you see in the file view: a claimed block gets its holder's colour down the edge, and a shimmer sweeps
// across it while the agent works (.ln.claim.bot); a rewritten line cross-fades (.ln.xfade), a new one grows in
// (.ln.rise), a deleted one folds away (.ln.fold); a fresh line flashes the accent (.ln.flash).
import { serve } from "@rustybuns/shell-bun";
import worker from "../src/worker.ts";
import { local } from "../src/local.ts";

const arg = (n: string, d: number) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? Number(process.argv[i + 1]) : d; };
const PORT = arg("port", 4747), ROUNDS = arg("rounds", 3), PACE = arg("pace", 700), WAIT = arg("wait", 20);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FILE = "src/server.ts";

const SOURCE = `import { serve } from "bun";

// Routes
const routes = {
  "/": () => new Response("hello"),
  "/health": () => new Response("ok"),
  "/users": () => Response.json([]),
};

// Auth
function checkToken(req: Request) {
  return req.headers.get("authorization") === "secret";
}

// Rate limit
const hits = new Map<string, number>();
function limited(ip: string) {
  hits.set(ip, (hits.get(ip) ?? 0) + 1);
  return hits.get(ip)! > 100;
}

// Logging
function log(msg: string) {
  console.log(msg);
}

// Server
serve({
  port: 3000,
  fetch(req) {
    const url = new URL(req.url);
    return routes[url.pathname]?.() ?? new Response("not found", { status: 404 });
  },
});
`;

const call = await local({ GH_CLI: "off" });
// The page itself is the built client (build.ts copies src/client.html to dist/client).
if (!(await Bun.file("dist/client/index.html").exists())) await Bun.$`bun run build.ts`.quiet();
const shell = serve({ port: PORT, assets: "dist/client", runWorkerFirst: ["/api"], reporter: { escaped: (...a: unknown[]) => console.error("[server]", ...a) } as any });
shell.mount(worker as any, call.env);

const j = (user: string, path: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
  call(user, "/api" + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
await j("ryan", "/login", { name: "ryan" });
await j("ryan", "/repos", { name: "office", visibility: "public" });
await j("ryan", "/repos/ryan/office/files", { path: FILE, content: SOURCE });
for (const a of ["agent-ada", "agent-bo", "agent-cy"]) await j("ryan", "/repos/ryan/office/collaborators", { name: a });

const at = `/repos/ryan/office/do`, q = `?path=${encodeURIComponent(FILE)}`;
type Line = { id: string; text: string; rev: number; by: string };
const read = async () => ((await (await j("ryan", `${at}/file${q}`)).json()) as { lines: Line[] }).lines;
/** The block under a `// marker` comment: its lines up to the next blank one. */
const find = async (marker: string) => {
  const ls = await read(), i = ls.findIndex((l) => l.text === marker), n = ls.slice(i).findIndex((l) => l.text === "");
  return ls.slice(i + 1, i + n);
};
const say = (who: string, what: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${who.padEnd(10)} ${what}`);

/** What each agent does to its block: a rewrite per line, a pause between so the shimmer shows, then one insert. */
const JOBS = [
  { who: "agent-ada", marker: "// Auth", task: "swap the shared secret for a bearer token check", add: "// ada: tokens rotate daily" },
  { who: "agent-bo", marker: "// Rate limit", task: "give the rate limit a time window", add: "// bo: window is per minute" },
  { who: "agent-cy", marker: "// Logging", task: "structured logs", add: "// cy: logs are JSON now" },
];

async function work(job: (typeof JOBS)[number], round: number) {
  const { who } = job;
  const block = await find(job.marker);
  const claim = (await (await j(who, `${at}/claims${q}`, { id: `run-${who.slice(6)}-${round}`, task: job.task, lines: block.map((l) => l.id) })).json()) as { id: string };
  say(who, `claimed ${block.length} lines: ${job.task}`);
  for (const l of block) {
    await sleep(PACE + Math.random() * PACE);
    const cur = (await read()).find((x) => x.id === l.id)!;
    const text = cur.text.replace(/ \/\/ r\d+$/, "") + ` // r${round}`;
    const r = await j(who, `${at}/ops${q}`, { claim: claim.id, ops: [{ kind: "set", line: l.id, base: cur.rev, text }] });
    say(who, r.ok ? `rewrote  ${l.text.trim().slice(0, 44)}` : `refused (${r.status})`);
  }
  await sleep(PACE);
  const ins = await j(who, `${at}/ops${q}`, { claim: claim.id, ops: [{ kind: "insert", after: block.at(-1)!.id, text: `${job.add} (r${round})` }] });
  say(who, ins.ok ? "added a line" : `insert refused (${ins.status})`);
  await sleep(PACE * 2);
  // Take the line back out the round after, so the file doesn't grow for ever: a delete folds away.
  await j(who, `${at}/release${q}`, { id: claim.id });
  say(who, "released");
}

/** A fourth try: ada reaching for bo's lines while bo holds them, to see the refusal and who holds what. */
async function collide() {
  const block = await find("// Rate limit"), cur = (await read()).find((l) => l.id === block[1]!.id)!;
  const r = await j("agent-ada", `${at}/ops${q}`, { ops: [{ kind: "set", line: cur.id, base: cur.rev, text: cur.text + " // ada was here" }] });
  say("agent-ada", r.status === 409 ? "tried bo's lines: 409, held" : `tried bo's lines: ${r.status}`);
}

console.log(`\nOpen: ${shell.url}/#/r/ryan/office\n(sign in as "ryan" first: run  document.cookie = "cs_user=ryan; path=/"  in the page console, then reload)`);
console.log(`Then open ${FILE}. Edits start in ${WAIT}s.\n`);
await sleep(WAIT * 1000);

for (let round = 1; round <= ROUNDS; round++) {
  say("demo", `round ${round}`);
  const runs = JOBS.map((job, i) => sleep(i * PACE).then(() => work(job, round)));
  await sleep(PACE * 6).then(collide);
  await Promise.all(runs);
}
say("demo", "done. Ctrl-C to stop the server");
await new Promise(() => {});
