// Cuts: select some lines, cut them out as a tiny repo, run its tests, share
// it, and merge a fix back. A cut is a branch, `cut-<id>`, whose copy of each
// file is forked from main with only the picked lines in it, each keeping its
// id and rev. So the cut's files are a branch's files like any other: edit
// them with ?branch=cut-<id>, and merging the branch is the same three-way
// merge by line id. Main's lines that were never in the cut aren't in its
// base, so the merge leaves them alone.
//
// What a cut pulls in: the picked ranges, plus each file's import statements
// that bind a name the picked lines use (or import for side effects).
// Following those imports into other files is not done yet; add their lines
// as more pieces.
//
//   POST /api/repos/:o/:r/cuts      {pieces: [{path, from, to}], note?}  the crew; from/to are line numbers now
//   GET  /api/cuts/:id              its files, each line with where it came from on main, and the last run
//   POST /api/cuts/:id/run          bun test on the cut (the owner: on the desktop, or a container for admins)
//   GET  /api/cuts/:id/card.png     the social card: the code and its test result
//   GET  /api/cuts/:id/share        a page for link previews (og:image), sending people on to the cut

import { materialize, toFile } from "./archive.ts";
import { renderCard, type CardLine } from "./card.ts";
import { json, type Env } from "./env.ts";
import { isAdmin } from "./identity.ts";
import type { Doc, Line } from "./lines.ts";

export type Mark = "pass" | "fail";
export interface CutRun { at: number; code: number; passed: number; failed: number; out: string; marks: Record<string, Record<string, Mark>>; note?: string }
/** Run `bun test` over these files (path → text) and say how it went. */
export type Tester = (files: Record<string, string>) => Promise<{ code: number; out: string; report?: string }>;
/** Where `bun test` writes its JUnit report, beside the cut's files. */
export const REPORT = ".cut-report.xml";

const MAX_LINES = 500, MAX_PIECES = 20, MAX_OUT = 20_000;

/** Each import statement in a file: its line ids, and the names it binds ([] for `import "x"`). */
export function imports(lines: { id: string; text: string }[]) {
  const out: { ids: string[]; names: string[] }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*import(\s|\{|\*|["'])/.test(lines[i]!.text)) continue;
    let j = i;
    while (j < lines.length - 1 && j - i < 60 && !/\bfrom\s*["']|^\s*import\s*["']/.test(lines[j]!.text)) j++;
    const stmt = lines.slice(i, j + 1).map((l) => l.text).join("\n");
    const clause = /^\s*import\s*["']/.test(stmt) ? "" : stmt.replace(/^\s*import\s+(type\s+)?/, "").replace(/\s*\bfrom\s*["'][\s\S]*$/, "");
    const names = clause.split(/[{},]/).map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()!.trim()).filter((s) => /^[A-Za-z_$][\w$]*$/.test(s));
    out.push({ ids: lines.slice(i, j + 1).map((l) => l.id), names });
    i = j;
  }
  return out;
}

/** The picked lines plus the imports they use, in file order, ids and revs intact. */
export function pick(lines: Line[], ranges: [number, number][]) {
  const want = new Set(ranges.flatMap(([a, b]) => lines.slice(a - 1, b).map((l) => l.id)));
  const stmts = imports(lines), inImport = new Set(stmts.flatMap((s) => s.ids));
  const body = lines.filter((l) => want.has(l.id) && !inImport.has(l.id)).map((l) => l.text).join("\n");
  const uses = (n: string) => new RegExp(`(^|[^\\w$])${n.replace(/\$/g, "\\$")}($|[^\\w$])`).test(body);
  for (const s of stmts) if (!s.names.length || s.names.some(uses)) s.ids.forEach((id) => want.add(id));
  return lines.filter((l) => want.has(l.id));
}

/**
 * Read a `bun test` run: its JUnit report marks each test pass or fail on the
 * line that declares it, and a stack frame in the output marks fail on the
 * cut line it points at.
 */
export function readRun(out: string, report: string, files: { path: string; lines: { id: string; text: string }[] }[]) {
  const marks: Record<string, Record<string, Mark>> = {};
  const fileOf = (p: string) => files.find((f) => p === f.path || p.endsWith("/" + f.path));
  const mark = (p: string, n: number, m: Mark) => {
    const f = fileOf(p), l = f?.lines[n - 1];
    if (!f || !l) return;
    const at = (marks[f.path] ??= {});
    if (at[l.id] !== "fail") at[l.id] = m;
  };
  let passed = 0, failed = 0;
  for (const t of report.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attr = (k: string) => new RegExp(`\\b${k}="([^"]*)"`).exec(t[1]!)?.[1];
    if (/<skipped\b/.test(t[2] ?? "")) continue;
    const bad = /<(failure|error)\b/.test(t[2] ?? "");
    bad ? failed++ : passed++;
    mark(attr("file") ?? "", Number(attr("line")), bad ? "fail" : "pass");
  }
  for (const frame of out.replace(/\x1b\[[0-9;]*m/g, "").split("\n").filter((l) => /^\s*at\s/.test(l)))
    for (const m of frame.matchAll(/([\w@.\/-]+\.[cm]?[jt]sx?):(\d+)(?::\d+)?/g)) mark(m[1]!, Number(m[2]), "fail");
  return { marks, passed, failed };
}

/** A scratch directory on this machine: the cut's files, `bun test`, then the directory is deleted. */
const localTester = (): Tester => async (files) => {
  const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { dirname, join, relative } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "codesplitters-cut-"));
  try {
    for (const [path, text] of Object.entries(files)) {
      const at = join(dir, path);
      if (relative(dir, at).startsWith("..")) continue;
      mkdirSync(dirname(at), { recursive: true });
      writeFileSync(at, text);
    }
    const p = Bun.spawn(["bun", "test", "--reporter=junit", `--reporter-outfile=${REPORT}`], { cwd: dir, stdout: "pipe", stderr: "pipe", timeout: 120_000, env: { ...process.env, CI: "1" } });
    const [o, e] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    const code = await p.exited;
    return { code, out: o + e, report: await Bun.file(join(dir, REPORT)).text().catch(() => "") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** The agent sandbox's container (sandbox.ts), one per run: its server's /test does the same as localTester. */
const containerTester = (ns: NonNullable<Env["AGENT_SANDBOX"]>): Tester => async (files) => {
  const res = await ns.get(ns.idFromName(crypto.randomUUID())).fetch(new Request("http://sandbox/test", { method: "POST", body: JSON.stringify({ files }) }));
  if (!res.ok) throw new Error(`sandbox: ${res.status} ${await res.text()}`);
  return (await res.json()) as { code: number; out: string; report?: string };
};

/** Where a cut's tests can run for `user`: tests stand in; the desktop runs them itself; on Cloudflare, a container for admins (it bills the site). */
function testerFor(env: Env, user: string | null): Tester | null {
  if (env.CUT_TESTER) return env.CUT_TESTER as Tester;
  if (env.AGENT_SANDBOX) return env.ADMINS && isAdmin(env, user) ? containerTester(env.AGENT_SANDBOX) : null;
  return typeof Bun !== "undefined" && !env.BETTER_AUTH_SECRET ? localTester() : null;
}

const doc = async (env: Env, owner: string, repo: string, path: string, branch?: string) =>
  (await (await toFile(env, owner, repo, path, "cut", "file", {}, "", branch)).json()) as Doc;
const toDisk = (lines: { text: string }[]) => lines.length ? lines.map((l) => l.text).join("\n") + "\n" : "";

export async function createCut(env: Env, owner: string, repo: string, user: string | null, write: boolean, body: any) {
  if (!user) return json({ error: "sign in first" }, 401);
  // A cut is a branch, and its fix merges into the repo: the crew's.
  if (!write) return json({ error: "only the crew can cut lines: a cut is a branch of the repo" }, 403);
  const pieces = (Array.isArray(body?.pieces) ? body.pieces : [body]) as { path?: string; from?: number; to?: number }[];
  if (!pieces.length || pieces.length > MAX_PIECES) return json({ error: `cut 1 to ${MAX_PIECES} ranges` }, 400);
  const byPath = new Map<string, [number, number][]>();
  for (const p of pieces) {
    const path = String(p?.path ?? ""), from = Math.floor(Number(p?.from)), to = Math.floor(Number(p?.to ?? p?.from));
    if (!path || !(from >= 1) || !(to >= from)) return json({ error: "each piece needs a path and lines from ≤ to" }, 400);
    byPath.set(path, [...(byPath.get(path) ?? []), [from, to]]);
  }
  const files: { path: string; doc: Doc }[] = [];
  for (const [path, ranges] of byPath) {
    const m = await materialize(env, owner, repo, path);
    if ("error" in m) return json({ error: `${path}: ${m.error}` }, m.status);
    const main = await doc(env, owner, repo, path);
    if (ranges.some(([a]) => !main.lines[a - 1])) return json({ error: `${path} has no such lines` }, 400);
    files.push({ path, doc: { rev: main.rev, nextId: main.nextId, lines: pick(main.lines, ranges) } });
  }
  if (files.reduce((n, f) => n + f.doc.lines.length, 0) > MAX_LINES) return json({ error: `cut at most ${MAX_LINES} lines` }, 400);

  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 10), branch = `cut-${id}`, now = Date.now();
  await env.DB.prepare("INSERT INTO branches (owner, repo, name, by, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)").bind(owner, repo, branch, user, now).run();
  for (const f of files) {
    // The branch's copy starts as just these lines: its base too, so a merge only touches them.
    await toFile(env, owner, repo, f.path, user, "fork", { method: "POST", body: JSON.stringify({ doc: f.doc }) }, "", branch);
    await env.DB.prepare("INSERT OR IGNORE INTO branch_files (owner, repo, branch, path) VALUES (?, ?, ?, ?)").bind(owner, repo, branch, f.path).run();
  }
  await env.DB.prepare("INSERT INTO cuts (id, owner, repo, branch, paths, by, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, owner, repo, branch, JSON.stringify(files.map((f) => f.path)), user, String(body?.note ?? "").slice(0, 280), now).run();
  return json({ id, branch, files: files.map((f) => ({ path: f.path, lines: f.doc.lines.length })) }, 201);
}

interface CutRow { id: string; owner: string; repo: string; branch: string; paths: string; by: string; note: string; created_at: number; run: string | null; status: string }

/** The cut's files as they are on its branch, each line with its line number on main now (null: new in the cut, or gone from main). */
async function cutFiles(env: Env, c: CutRow) {
  return Promise.all((JSON.parse(c.paths) as string[]).map(async (path) => {
    const [cut, main] = await Promise.all([doc(env, c.owner, c.repo, path, c.branch), doc(env, c.owner, c.repo, path)]);
    const at = new Map(main.lines.map((l, i) => [l.id, i + 1]));
    return { path, lines: cut.lines.map((l) => ({ ...l, n: at.get(l.id) ?? null })) };
  }));
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const summary = (run: CutRun | null) => !run ? "not run yet" : run.note ?? `${run.passed} passed, ${run.failed} failed`;

export async function cutRoutes(req: Request, env: Env, p: string[], url: URL, user: string | null): Promise<Response | null> {
  if (p[1] !== "cuts" || !p[2]) return null;
  // Like a shared range, the link is the key: it shows only the cut's lines, even from a private repo.
  const c = await env.DB.prepare(`SELECT c.*, b.status FROM cuts c JOIN repos r ON r.owner = c.owner AND r.name = c.repo
    JOIN branches b ON b.owner = c.owner AND b.repo = c.repo AND b.name = c.branch WHERE c.id = ? AND (r.expires_at IS NULL OR r.expires_at > ?)`).bind(p[2], Date.now()).first() as CutRow | null;
  if (!c) return json({ error: "no such cut" }, 404);
  const run: CutRun | null = c.run ? JSON.parse(c.run) : null;

  // GET /api/cuts/:id
  if (!p[3] && req.method === "GET") {
    const { run: _, ...rest } = c;
    return json({ ...rest, paths: JSON.parse(c.paths), files: await cutFiles(env, c), run, can_run: user === c.owner && !!testerFor(env, user) });
  }

  // POST /api/cuts/:id/run
  if (p[3] === "run" && req.method === "POST") {
    // It runs the cut's code: the repo owner's call, like a preview deploy.
    if (user !== c.owner) return json({ error: "only the repo's owner can run a cut" }, 403);
    const tester = testerFor(env, user);
    if (!tester) return json({ error: env.AGENT_SANDBOX ? "hosted runs are limited to this site's admins (ADMINS)" : "cuts run on the desktop app, or in the agent sandbox on Cloudflare" }, 400);
    const files = await cutFiles(env, c);
    const t = await tester(Object.fromEntries(files.map((f) => [f.path, toDisk(f.lines)]))).catch((e: Error) => ({ code: -1, out: e.message }));
    const r = readRun(t.out, ("report" in t && t.report) || "", files);
    const out: CutRun = { at: Date.now(), code: t.code, ...r, out: t.out.slice(-MAX_OUT),
      note: /No tests found/i.test(t.out) ? "no tests in this cut: add the lines that test it" : t.code === -1 ? "the run didn't start" : undefined };
    await env.DB.prepare("UPDATE cuts SET run = ? WHERE id = ?").bind(JSON.stringify(out), c.id).run();
    return json(out);
  }

  // GET /api/cuts/:id/card.png
  if (p[3] === "card.png" && req.method === "GET") {
    const files = await cutFiles(env, c);
    const lines: CardLine[] = files.flatMap((f) => [
      ...(files.length > 1 ? [{ n: null, text: `// ${f.path}` }] : []),
      ...f.lines.map((l) => ({ n: l.n, text: l.text, mark: run?.marks[f.path]?.[l.id] })),
    ]);
    const png = await renderCard({ title: `${c.owner}/${c.repo}  ${files.length === 1 ? files[0]!.path : `${files.length} files`}`, lines, status: summary(run), ok: run && !run.note ? run.code === 0 : null });
    return new Response(png, { headers: { "content-type": "image/png", "cache-control": "public, max-age=60" } });
  }

  // GET /api/cuts/:id/share  link previews read the meta tags; people go on to the cut's page
  if (p[3] === "share" && req.method === "GET") {
    const title = `${c.owner}/${c.repo}: a cut of ${(JSON.parse(c.paths) as string[]).join(", ")}`;
    const desc = `${c.note ? c.note + " · " : ""}${summary(run)}. Cut out of the repo on codeSplitters: run it, fix it, merge it back.`;
    const page = `#/c/${c.id}`, image = `${url.origin}/api/cuts/${c.id}/card.png?at=${run?.at ?? 0}`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:url" content="${esc(url.href)}"><meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=/${page}"></head><body><a href="/${page}">${esc(title)}</a></body></html>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  return null;
}
