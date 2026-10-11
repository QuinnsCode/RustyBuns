import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BRANCH, FILES, prompts, seed } from "../seed.ts";

// A stand-in codeSplitters: files as lines with ids, a branch as a copy of main's,
// and a review that counts lines both sides set differently.
function fakeSite() {
  const calls: string[] = [];
  type L = { id: string; text: string; rev: number };
  const main: Record<string, L[]> = {}, branch: Record<string, L[]> = {}, base: Record<string, L[]> = {};
  let n = 0;
  const send = async (req: Request) => {
    const u = new URL(req.url), body = req.method === "GET" ? undefined : await req.json() as any;
    calls.push(`${req.method} ${u.pathname}`);
    expect(req.headers.get("authorization")).toBe("Bearer cst_test");
    const doc = () => (u.searchParams.get("branch") ? branch : main)[u.searchParams.get("path")!]!;
    if (u.pathname === "/api/repos") return Response.json({ owner: "quinn", name: body.name, visibility: "public" }, { status: 201 });
    if (u.pathname.endsWith("/files")) {
      main[body.path] = body.content.split("\n").map((text: string) => ({ id: `L${++n}`, text, rev: n }));
      return Response.json({ path: body.path }, { status: 201 });
    }
    if (u.pathname.endsWith("/do/commit")) return Response.json({ n: 1, sha: "abc" });
    if (u.pathname.endsWith("/branches") && req.method === "POST") {
      for (const [p, ls] of Object.entries(main)) { branch[p] = ls.map((l) => ({ ...l })); base[p] = ls.map((l) => ({ ...l })); }
      return Response.json({ name: body.name }, { status: 201 });
    }
    if (u.pathname.endsWith("/do/file")) return Response.json({ rev: n, lines: doc() });
    if (u.pathname.endsWith("/do/ops")) {
      const ls = doc();
      for (const op of body.ops) {
        if (op.kind === "set") { const l = ls.find((l) => l.id === op.line)!; expect(l.rev).toBe(op.base); Object.assign(l, { text: op.text, rev: ++n }); }
        if (op.kind === "insert") ls.splice(ls.findIndex((l) => l.id === op.after) + 1, 0, { id: `L${++n}`, text: op.text, rev: n });
      }
      return Response.json({ rev: n, applied: [] });
    }
    if (u.pathname.endsWith(`/branches/${BRANCH}`)) {
      const files = Object.keys(branch).map((path) => ({
        path, conflicts: base[path]!.filter((b) => {
          const m = main[path]!.find((l) => l.id === b.id), r = branch[path]!.find((l) => l.id === b.id);
          return m && r && m.text !== b.text && r.text !== b.text && m.text !== r.text;
        }),
      }));
      return Response.json({ files });
    }
    return new Response("not found", { status: 404 });
  };
  return { send, calls, main, branch };
}

test("seed makes the repo, commits the app and leaves exactly one conflict card", async () => {
  const site = fakeSite();
  const files = Object.fromEntries(FILES.map((f) => [f, readFileSync(join(import.meta.dir, "..", f), "utf8")]));
  const r = await seed({ url: "https://cs.test/", token: "cst_test", name: "snack-vote-demo", files, send: site.send, log: () => {} });

  expect(r).toMatchObject({ owner: "quinn", name: "snack-vote-demo", conflicts: 1, page: "https://cs.test/#/r/quinn/snack-vote-demo" });
  expect(site.calls.filter((c) => c.endsWith("/files"))).toHaveLength(FILES.length);
  // The branch's comment lands just above total(), where main changed nothing.
  const b = site.branch["src/tally.ts"]!.map((l) => l.text);
  expect(b[b.indexOf("export function total(votes: Votes): number {") - 1]).toBe("// Every vote so far, across all snacks.");
  expect(site.main["src/tally.ts"]!.some((l) => l.text.includes("leads with"))).toBe(true);
});

test("a failed call names itself", async () => {
  const send = async () => new Response("nope", { status: 403 });
  expect(seed({ url: "https://cs.test", token: "t", name: "x", files: {}, send, log: () => {} })).rejects.toThrow("POST /repos: 403 nope");
});

test("each prompt names the repo", () => {
  for (const p of prompts("quinn", "snack-vote-demo")) expect(p).toContain("quinn/snack-vote-demo");
});
