// Three agents edit one file at the same time. Each reads the file, picks one
// line to change, and sends an op pinned to that line's rev. Different lines
// never collide; when two agents grab the same line, the file's Durable Object
// takes the first and answers the second with 409, and that agent re-reads and
// tries again. At the end the owner commits and we print the blame.
//
//   bun agents.ts                      in-process, no server
//   bun agents.ts --url http://127.0.0.1:PORT --cookie 'rb_token_PORT=...'
//                                      against the running app, so you can watch

import { local, remote, type Call } from "./src/local.ts";
import type { Line, Op } from "./src/lines.ts";

const START = `// my taste in code
var foo = 0
function add(n) {
  foo = foo + n
  return foo
}
function reset() {
  foo = 0
}
var label = "sum is"
function show() {
  console.log(label, foo)
}`;

interface Agent { name: string; pick(lines: Line[]): { line: Line; op: Op } | null }

const agents: Agent[] = [
  { // var -> let. (Picking const needs the whole file to hold still, and other
    // agents are renaming it underneath us: line locks don't cover that.)
    name: "agent-linter",
    pick: (lines) => {
      const line = lines.find((l) => l.text.startsWith("var "));
      return line ? { line, op: { kind: "set", line: line.id, base: line.rev, text: line.text.replace(/^var /, "let ") } } : null;
    },
  },
  { // foo is a bad name
    name: "agent-renamer",
    pick: (lines) => {
      const line = lines.find((l) => /\bfoo\b/.test(l.text) && !l.text.startsWith("//"));
      return line ? { line, op: { kind: "set", line: line.id, base: line.rev, text: line.text.replace(/\bfoo\b/g, "total") } } : null;
    },
  },
  { // every function gets a doc line
    name: "agent-docs",
    pick: (lines) => {
      const i = lines.findIndex((l, i) => l.text.startsWith("function ") && !lines[i - 1]?.text.startsWith("/**"));
      if (i < 0) return null;
      const name = lines[i]!.text.slice(9).split("(")[0];
      return { line: lines[i]!, op: { kind: "insert", after: lines[i - 1]?.id ?? null, text: `/** ${name}: written by an agent */` } };
    },
  },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function run(call: Call, opts: { owner?: string; repo?: string; delay?: number; log?: (s: string) => void } = {}) {
  const owner = opts.owner ?? "ryan", repo = opts.repo ?? `playground-${Date.now().toString(36)}`, path = "src/taste.js";
  const log = opts.log ?? console.log;
  const ok = async (r: Promise<Response>) => { const res = await r; if (!res.ok) throw new Error(`${res.status} ${await res.text()}`); return res.json() as any; };
  const post = (user: string, url: string, body: unknown) => ok(call(user, url, { method: "POST", body: JSON.stringify(body) }));

  await post(owner, "/api/login", { name: owner });
  await post(owner, "/api/repos", { name: repo, visibility: "public" });
  for (const a of agents) await post(owner, `/api/repos/${owner}/${repo}/collaborators`, { name: a.name });
  await post(owner, `/api/repos/${owner}/${repo}/files`, { path, content: START });
  const file = `/api/repos/${owner}/${repo}/do`, q = `?path=${encodeURIComponent(path)}`;
  log(`${owner}/${repo}/${path}: ${START.split("\n").length} lines, ${agents.length} agents starting`);

  const stats = Object.fromEntries(agents.map((a) => [a.name, { edits: 0, conflicts: 0 }]));
  await Promise.all(agents.map(async (a) => {
    for (;;) {
      const doc = await ok(call(a.name, `${file}/file${q}`));
      const move = a.pick(doc.lines);
      if (!move) return;
      await sleep(Math.random() * (opts.delay ?? 5)); // think
      const res = await call(a.name, `${file}/ops${q}`, { method: "POST", body: JSON.stringify({ ops: [move.op] }) });
      if (res.status === 409) { stats[a.name]!.conflicts++; log(`  ${a.name}: conflict on ${move.line.id}, re-reading`); continue; }
      if (!res.ok) throw new Error(`${a.name}: ${res.status} ${await res.text()}`);
      stats[a.name]!.edits++;
      log(`  ${a.name}: ${move.op.kind} ${move.line.id}`);
    }
  }));

  const commit = await post(owner, `${file}/commit${q}`, { message: "three agents tidied this up" });
  const doc = await ok(call(owner, `${file}/file${q}`));
  return { owner, repo, path, commit, doc, stats };
}

if (import.meta.main) {
  const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
  const url = arg("--url");
  const call = url ? remote(url, arg("--cookie")) : await local();
  const { doc, commit, stats } = await run(call, { delay: url ? 400 : 5 });
  console.log(`\ncommit ${commit.sha.slice(0, 10)} at rev ${commit.rev}\n`);
  for (const l of doc.lines) console.log(`${l.by.padEnd(14)} r${String(l.rev).padEnd(3)} ${l.text}`);
  console.log("\n" + Object.entries(stats).map(([n, s]) => `${n}: ${s.edits} edits, ${s.conflicts} conflicts`).join("\n"));
}
