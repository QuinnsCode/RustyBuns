import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot, type Call } from "../src/local.ts";
import { text, type Doc } from "../src/lines.ts";
import { upstreamOf } from "../src/listen.ts";

// End to end: real git, in-process D1.
setDefaultTimeout(20_000);
const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });
const post = (call: Call, user: string | null, path: string, body: unknown) => call(user, path, { method: "POST", body: JSON.stringify(body) });

const A = "a".repeat(40), B = "b".repeat(40), C = "c".repeat(40);

test("upstream's parts: a repo, or a dug folder of one", () => {
  expect(upstreamOf("github:o/r", "main")).toEqual({ repo: "o/r", branch: "main", folder: "" });
  expect(upstreamOf("github:o/r/tree/feat/x/apps/web", "feat/x")).toEqual({ repo: "o/r", branch: "feat/x", folder: "apps/web" });
  expect(upstreamOf("https://example.com/r.git", "main")).toBeNull();
});

test("a dug fork hears upstream move on, and takes its changes onto a branch (#870)", async () => {
  const call = await boot({ GH_CLI: "off" });
  opened.push(call);
  // GitHub, faked: git's ref list, the compare API and raw files. Anything else is the app's own.
  const real = globalThis.fetch, asked: string[] = [];
  let tip = A;
  const files: Record<string, Record<string, string>> = {
    [A]: { "README.md": "hello\nmiddle\nworld\n", "old.ts": "x\n", "src/a.ts": "a = 1\n" },
    [B]: { "README.md": "hello\nmiddle\nworld, again\n", "new.ts": "n\n", "src/a.ts": "a = 1\n", "logo.png": "\0png" },
  };
  globalThis.fetch = (async (u: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof u === "string" ? u : u instanceof URL ? u.href : u.url);
    if (url.hostname === "github.com" && url.pathname === "/o/r.git/info/refs") return new Response(`${tip} HEAD\0side-band symref=HEAD:refs/heads/main\n${tip} refs/heads/main\n`);
    if (url.hostname === "api.github.com") {
      asked.push(url.pathname);
      if (url.pathname === `/repos/o/r/compare/${A}...${B}`) return Response.json({ ahead_by: 2, files: [
        { filename: "README.md", status: "modified" }, { filename: "old.ts", status: "removed" }, { filename: "new.ts", status: "added" }, { filename: "logo.png", status: "added" }] });
      if (url.pathname === `/repos/o/r/compare/${B}...${C}`) return new Response("{}", { status: 403 });
      return new Response("{}", { status: 404 });
    }
    if (url.hostname === "raw.githubusercontent.com") {
      const [, , , sha, ...path] = url.pathname.split("/");
      const t = files[sha!]?.[path.join("/")];
      return t === undefined ? new Response("", { status: 404 }) : new Response(t);
    }
    return real(u as any, init);
  }) as any;
  const { push } = await import("../src/git.ts");
  call.artifacts.import = (async (params: any) => {
    const art = await call.artifacts.create(params.target.name, { setDefaultBranch: "main" });
    await push(art.remote, art.token, { changes: files[A]!, message: "upstream", author: "upstream" });
    return art;
  }) as any;
  try {
    for (const u of ["ana", "bo"]) await post(call, u, "/api/login", { name: u });
    expect((await post(call, "ana", "/api/github/dig", { repo: "o/r" })).status).toBe(201);

    // Nothing new: git's ref list says so, and the API isn't asked.
    let u = await (await call("ana", "/api/repos/ana/r/upstream")).json() as any;
    expect([u.repo, u.branch, u.commit, u.tip, u.behind]).toEqual(["o/r", "main", A, A, 0]);
    expect(asked).toEqual([]);

    // Ana changes a line of the README here.
    const q = "?path=README.md", doc = await (await call("ana", `/api/repos/ana/r/do/file${q}`)).json() as Doc;
    await post(call, "ana", `/api/repos/ana/r/do/ops${q}`, { ops: [{ kind: "set", line: doc.lines[0]!.id, base: doc.lines[0]!.rev, text: "hello from ana" }] });

    // Upstream moves on: the page hears it once it's stale, the owner any time.
    tip = B;
    expect((await (await call("ana", "/api/repos/ana/r/upstream")).json() as any).behind).toBe(0);   // heard a moment ago
    expect((await post(call, "bo", "/api/repos/ana/r/upstream/hear", {})).status).toBe(403);
    u = await (await post(call, "ana", "/api/repos/ana/r/upstream/hear", {})).json() as any;
    expect([u.tip, u.behind]).toEqual([B, 2]);
    const meta = await (await call("bo", "/api/repos/ana/r")).json() as any;
    expect([meta.upstream_tip, meta.upstream_behind]).toEqual([B, 2]);

    // Take them: a branch of what upstream changed, ana's line kept where upstream didn't touch it.
    expect((await post(call, "bo", "/api/repos/ana/r/upstream/take", {})).status).toBe(403);
    const took = await (await post(call, "ana", "/api/repos/ana/r/upstream/take", {})).json() as any;
    expect(took).toMatchObject({ name: "upstream-bbbbbbb", from: A, commit: B, commits: 2, files: ["README.md", "new.ts"], deleted: ["old.ts"], skipped: ["logo.png"] });
    const onBranch = async (path: string) => text(await (await call("ana", `/api/repos/ana/r/do/file?path=${path}&branch=upstream-bbbbbbb`)).json() as Doc);
    expect(await onBranch("README.md")).toBe("hello from ana\nmiddle\nworld, again");
    expect(await onBranch("new.ts")).toBe("n");
    // Main is as it was until the branch merges; the fork now stands at upstream's tip.
    expect(text(await (await call("ana", `/api/repos/ana/r/do/file${q}`)).json() as Doc)).toBe("hello from ana\nmiddle\nworld");
    u = await (await call("ana", "/api/repos/ana/r/upstream")).json() as any;
    expect([u.commit, u.tip, u.behind]).toEqual([B, B, 0]);
    expect((await post(call, "ana", "/api/repos/ana/r/upstream/take", {})).status).toBe(409);

    // The hourly cron hears it next; GitHub's rate limit spent, it still knows the tip moved.
    tip = C;
    await call.env.DB.prepare("UPDATE repos SET upstream_heard_at = 0 WHERE owner = 'ana' AND name = 'r'").run();
    const { hearDue } = await import("../src/listen.ts");
    await hearDue(call.env);
    u = await (await call("ana", "/api/repos/ana/r/upstream")).json() as any;
    expect([u.tip, u.behind]).toEqual([C, null]);
  } finally { globalThis.fetch = real; }
});
