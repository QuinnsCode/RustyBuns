import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beamMessage, sortOut } from "../src/beam.ts";
import { local as boot } from "../src/local.ts";

setDefaultTimeout(30_000);
const root = mkdtempSync(join(tmpdir(), "codesplitter-beam-"));
writeFileSync(join(root, "gitconfig"), "[user]\n\tname = Ana Real\n\temail = ana@example.com\n[init]\n\tdefaultBranch = main\n");
process.env.GIT_CONFIG_GLOBAL = join(root, "gitconfig");
const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); rmSync(root, { recursive: true, force: true }); });

const sh = async (cmd: string, cwd = root) => {
  const p = Bun.spawn(["sh", "-c", cmd], { cwd, stdout: "pipe", stderr: "pipe", env: process.env });
  const [code, out, err] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  if (code) throw new Error(`${cmd}: ${err}`);
  return out.trim();
};

describe("the clean-up", () => {
  const c = (path: string, status = "M") => ({ path, status });

  test("leaves out a foreign lockfile, install churn, installed packages, build output, clutter and env files, each with why", () => {
    const { kept, dropped } = sortOut([c("src/a.ts"), c("bun.lock", "A"), c("pnpm-lock.yaml"), c("node_modules/x/i.js", "A"), c("dist/app.js", "A"),
      c(".DS_Store", "A"), c("debug.log", "A"), c(".env.local", "A"), c(".env.example", "A"), c("docs/guide.md", "A")]);
    expect(kept.map((k) => k.path)).toEqual(["src/a.ts", ".env.example", "docs/guide.md"]);
    expect(Object.fromEntries(dropped.map((d) => [d.path, d.why]))).toEqual({
      "bun.lock": "a lockfile this repo doesn't use",
      "pnpm-lock.yaml": "lockfile churn from an install: no package.json changed",
      "node_modules/x/i.js": "installed packages or a tool's cache",
      "dist/app.js": "build output",
      ".DS_Store": "OS clutter",
      "debug.log": "an editor, log or patch leftover",
      ".env.local": "an env file: it may hold secrets",
    });
  });

  test("keeps the lockfile when package.json changed with it, and dist/ the repo already had", () => {
    expect(sortOut([c("package.json"), c("pnpm-lock.yaml"), c("dist/app.js")]).dropped).toEqual([]);
  });

  test("keep and drop override the rules", () => {
    const { kept, dropped } = sortOut([c("bun.lock", "A"), c("src/a.ts"), c("src/b.ts")], { keep: ["bun.lock"], drop: ["src/b.ts"] });
    expect(kept.map((k) => k.path)).toEqual(["bun.lock", "src/a.ts"]);
    expect(dropped).toEqual([{ path: "src/b.ts", why: "you left it out" }]);
  });

  test("the message: a title, the stack's subjects, and the other authors as co-authors", () => {
    const ana = { name: "Ana", email: "ana@x" }, bo = { name: "Bo", email: "bo@x" };
    expect(beamMessage({ subjects: ["fix the thing"], body: "Because.", author: ana, authors: [ana] })).toBe("fix the thing\n\nBecause.\n");
    expect(beamMessage({ title: "Bun PTY", subjects: ["a", "b"], author: ana, authors: [ana, bo, bo] }))
      .toBe("Bun PTY\n\nSquashed from 2 commits:\n\n- a\n- b\n\nCo-authored-by: Bo <bo@x>\n");
    expect(beamMessage({ subjects: ["a", "b"], message: "Mine.", author: ana, authors: [ana] })).toBe("a\n\nMine.\n");
  });
});

describe("beaming a branch", () => {
  async function lab() {
    const call = await boot();
    opened.push(call);
    const post = (u: string, url: string, body: unknown) => call(u, url, { method: "POST", body: JSON.stringify(body) });
    for (const u of ["ana", "bo"]) await post(u, "/api/login", { name: u });
    expect((await post("ana", "/api/repos", { name: "lab" })).status).toBe(201);
    for (const [path, content] of [["src/a.ts", "export const a = 1;\nexport const b = 2;\n"], ["package.json", '{ "name": "lab" }\n'], ["pnpm-lock.yaml", "lockfileVersion: 9\n"]]) {
      expect((await post("ana", "/api/repos/ana/lab/files", { path, content })).status).toBeLessThan(300);
      expect((await post("ana", `/api/repos/ana/lab/do/commit?path=${path}`, { message: `add ${path}` })).status).toBe(200);
    }
    const bare = call.artifacts.path("ana--lab"), work = mkdtempSync(join(root, "work-"));
    await sh(`git clone -q ${bare} . && git checkout -q -b fix`, work);
    return { call, post, bare, work };
  }

  /** A stack like a real one: the change, an agent's follow-up, and the install noise around them. */
  async function stack(work: string) {
    await sh(`printf 'export const a = 10;\\nexport const b = 2;\\n' > src/a.ts && git commit -qam "a is ten"`, work);
    await sh(`printf 'lockfile\\n' > bun.lock && printf 'x' > .DS_Store && printf 'lockfileVersion: 9\\n# churn\\n' > pnpm-lock.yaml && git add -A && git commit -qm "install"`, work);
    await sh(`printf 'export const a = 10;\\nexport const b = 20;\\n' > src/a.ts && git -c user.name=Bo -c user.email=bo@example.com commit -qam "b is twenty too"`, work);
    await sh(`git push -q origin fix`, work);
  }

  test("squashes the stack onto main without its noise, keeps it under refs/beams, and hands over a patch that applies", async () => {
    const { call, post, bare, work } = await lab();
    await stack(work);
    const main = await sh(`git --git-dir ${bare} rev-parse main`);

    // The crew sees the branch there is to beam.
    const list = await (await call("ana", "/api/repos/ana/lab/beams")).json() as any;
    expect(list.branches).toEqual([{ name: "fix", sha: expect.any(String), ahead: 3 }]);

    const res = await post("ana", "/api/repos/ana/lab/beams", { branch: "fix", title: "Bigger numbers", to: "bo" });
    expect(res.status).toBe(201);
    const beam = await res.json() as any;
    expect(beam.id).toMatch(/^[0-9a-f]{32}$/);
    expect(beam).toMatchObject({ branch: "fix", by: "ana", to: "bo", title: "Bigger numbers", commits: 3, onto: { sha: main, label: "main" },
      files: [{ path: "src/a.ts", status: "M" }], page: `/#/beam/${beam.id}`, patch: `/api/beams/${beam.id}/patch` });
    expect(beam.dropped.map((d: any) => d.path).sort()).toEqual([".DS_Store", "bun.lock", "pnpm-lock.yaml"]);
    expect(beam.message).toBe("Squashed from 3 commits:\n\n- a is ten\n- install\n- b is twenty too\n\nCo-authored-by: Bo <bo@example.com>");

    // One commit, on main, by whoever beamed it (this machine's git identity), kept by its ref.
    expect(await sh(`git --git-dir ${bare} rev-parse refs/beams/${beam.id}`)).toBe(beam.sha);
    expect(await sh(`git --git-dir ${bare} rev-parse ${beam.sha}^`)).toBe(main);
    expect(await sh(`git --git-dir ${bare} log -1 --format='%an <%ae>' ${beam.sha}`)).toBe("Ana Real <ana@example.com>");
    expect(await sh(`git --git-dir ${bare} diff --name-only main ${beam.sha}`)).toBe("src/a.ts");

    // Anyone with the link reads it, signed in or not; the diff has the change and none of the noise.
    const page = await (await call(null, `/api/beams/${beam.id}`)).json() as any;
    expect(page.diff).toContain("+export const b = 20;");
    expect(page.diff).not.toContain("bun.lock");
    expect(page.diff_truncated).toBe(false);

    // The patch is git am's.
    const patch = await call(null, `/api/beams/${beam.id}/patch`);
    expect(patch.headers.get("content-disposition")).toContain(`beam-${beam.id}.patch`);
    const text = await patch.text();
    expect(text).toContain("Subject: [PATCH] Bigger numbers");
    const them = mkdtempSync(join(root, "them-"));
    writeFileSync(join(root, "beam.patch"), text);
    await sh(`git clone -q ${bare} . && git am -q ${join(root, "beam.patch")}`, them);
    expect(await Bun.file(join(them, "src/a.ts")).text()).toBe("export const a = 10;\nexport const b = 20;\n");
    expect(await sh(`git log -1 --format=%s`, them)).toBe("Bigger numbers");

    // It's in bo's inbox, and in ana's own list.
    const bo = await (await call("bo", "/api/me/beams")).json() as any;
    expect(bo.to_you.map((b: any) => b.id)).toEqual([beam.id]);
    expect(bo.to_you[0]).toMatchObject({ files: 1, dropped: 3 });
    expect((await (await call("ana", "/api/me/beams")).json() as any).yours.map((b: any) => b.id)).toEqual([beam.id]);
    expect((await (await call("ana", "/api/repos/ana/lab/beams")).json() as any).beams.map((b: any) => b.id)).toEqual([beam.id]);

    // Withdrawn: only whoever beamed it or the owner; the commit's ref goes, the page says so.
    expect((await call("bo", `/api/beams/${beam.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await call("ana", `/api/beams/${beam.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await (await call(null, `/api/beams/${beam.id}`)).json() as any).status).toBe("withdrawn");
    expect((await call(null, `/api/beams/${beam.id}/patch`)).status).toBe(410);
    expect((await git(bare, `rev-parse --verify --quiet refs/beams/${beam.id}`))).toBe("");
    expect((await (await call("bo", "/api/me/beams")).json() as any).to_you).toEqual([]);
  });

  test("beams a codeSplitter branch: its files as they are now, on main's tip, as one commit", async () => {
    const { call, post, bare } = await lab();
    expect((await post("ana", "/api/repos/ana/lab/branches", { name: "tune" })).status).toBe(201);
    const doc = await (await call("ana", "/api/repos/ana/lab/do/file?path=src/a.ts&branch=tune")).json() as any;
    expect((await post("ana", "/api/repos/ana/lab/do/ops?path=src/a.ts&branch=tune", { ops: [{ kind: "set", line: doc.lines[1].id, text: "export const b = 3;", base: doc.lines[1].rev }] })).status).toBe(200);
    // Written with its trailing newline, which keeps an empty last line (#1041).
    expect((await post("ana", "/api/repos/ana/lab/files", { path: "keep.md", content: "stays\n", branch: "tune" })).status).toBe(201);
    const main = await sh(`git --git-dir ${bare} rev-parse main`);

    const list = await (await call("ana", "/api/repos/ana/lab/beams")).json() as any;
    expect(list.codesplitter_branches).toEqual([{ name: "tune", by: "ana", parent: null, files: 2 }]);
    // A git branch of that name there isn't.
    expect((await post("ana", "/api/repos/ana/lab/beams", { branch: "tune" })).status).toBe(404);
    expect((await post("ana", "/api/repos/ana/lab/beams", { branch: "nope", kind: "codesplitter" })).status).toBe(404);
    expect((await post("ana", "/api/repos/ana/lab/beams", { branch: "tune", kind: "svn" })).status).toBe(400);

    const res = await post("ana", "/api/repos/ana/lab/beams", { branch: "tune", kind: "codesplitter" });
    expect(res.status).toBe(201);
    const beam = await res.json() as any;
    expect(beam).toMatchObject({ branch: "tune", kind: "codesplitter", commits: 0, title: "tune, from codeSplitter", onto: { sha: main, label: "main" },
      files: [{ path: "keep.md", status: "A" }, { path: "src/a.ts", status: "M" }], dropped: [] });
    expect(await sh(`git --git-dir ${bare} rev-parse ${beam.sha}^`)).toBe(main);
    expect(await sh(`git --git-dir ${bare} log -1 --format='%an <%ae>' ${beam.sha}`)).toBe("Ana Real <ana@example.com>");
    expect(await sh(`git --git-dir ${bare} show ${beam.sha}:src/a.ts`)).toBe("export const a = 1;\nexport const b = 3;");
    // One newline at the end, as main commits it, not a blank line nobody wrote. (sh trims, so the size.)
    expect(await sh(`git --git-dir ${bare} cat-file -s ${beam.sha}:keep.md`)).toBe("6");
    expect((await (await call(null, `/api/beams/${beam.id}`)).json() as any).diff).toContain("+export const b = 3;");
  });

  test("beams a codeSplitter branch stacked on another as two commits, the one under it first (#1025)", async () => {
    const { call, post, bare } = await lab();
    const set = async (branch: string, i: number, t: string) => {
      const doc = await (await call("ana", `/api/repos/ana/lab/do/file?path=src/a.ts&branch=${branch}`)).json() as any, l = doc.lines[i];
      expect((await post("ana", `/api/repos/ana/lab/do/ops?path=src/a.ts&branch=${branch}`, { ops: [{ kind: "set", line: l.id, text: t, base: l.rev }] })).status).toBe(200);
    };
    await post("ana", "/api/repos/ana/lab/branches", { name: "first" });
    await set("first", 0, "export const a = 10;");
    await post("ana", "/api/repos/ana/lab/branches", { name: "second", parent: "first" });
    await set("second", 1, "export const b = 20;");
    expect((await post("ana", "/api/repos/ana/lab/files", { path: "src/c.ts", content: "export const c = 3;", branch: "second" })).status).toBe(201);
    const main = await sh(`git --git-dir ${bare} rev-parse main`);

    const res = await post("ana", "/api/repos/ana/lab/beams", { branch: "second", kind: "codesplitter", title: "b is twenty" });
    expect(res.status).toBe(201);
    const beam = await res.json() as any;
    expect(beam.stack.map((c: any) => [c.branch, c.title])).toEqual([["first", "first, from codeSplitter"], ["second", "b is twenty"]]);
    expect(beam.sha).toBe(beam.stack[1].sha);
    expect(await sh(`git --git-dir ${bare} rev-parse refs/beams/${beam.id}`)).toBe(beam.stack[1].sha);
    expect(await sh(`git --git-dir ${bare} rev-parse ${beam.sha}^`)).toBe(beam.stack[0].sha);
    expect(await sh(`git --git-dir ${bare} rev-parse ${beam.sha}^^`)).toBe(main);
    expect(await sh(`git --git-dir ${bare} show ${beam.stack[0].sha}:src/a.ts`)).toBe("export const a = 10;\nexport const b = 2;");
    expect(await sh(`git --git-dir ${bare} diff --name-only ${beam.stack[0].sha} ${beam.sha}`)).toBe("src/a.ts\nsrc/c.ts");
    expect(await sh(`git --git-dir ${bare} show ${beam.sha}:src/a.ts`)).toBe("export const a = 10;\nexport const b = 20;");
    expect(beam.files).toEqual([{ path: "src/a.ts", status: "M" }, { path: "src/c.ts", status: "A" }]);
    // The patch is both commits, in order, for `git am`.
    const patch = await (await call(null, `/api/beams/${beam.id}/patch`)).text();
    expect(patch).toContain("Subject: [PATCH 1/2] first, from codeSplitter");
    expect(patch).toContain("Subject: [PATCH 2/2] b is twenty");

    // A copy made before the branch under it touched that file would take that change back out: it says so.
    await post("ana", "/api/repos/ana/lab/branches", { name: "third", parent: "second" });
    expect((await call("ana", "/api/repos/ana/lab/do/file?path=package.json&branch=third")).status).toBe(200);
    const doc = await (await call("ana", "/api/repos/ana/lab/do/file?path=package.json&branch=second")).json() as any;
    await post("ana", "/api/repos/ana/lab/do/ops?path=package.json&branch=second", { ops: [{ kind: "set", line: doc.lines[0].id, text: '{ "name": "lab2" }', base: doc.lines[0].rev }] });
    const stale = await post("ana", "/api/repos/ana/lab/beams", { branch: "third", kind: "codesplitter" });
    expect(stale.status).toBe(409);
    expect((await stale.json() as any).clash).toEqual(["package.json"]);
  });

  test("says what clashes when main changed the same lines since, and refuses what isn't a beam", async () => {
    const { call, post, work } = await lab();
    expect((await post("bo", "/api/repos/ana/lab/beams", { branch: "fix" })).status).toBe(403);
    expect((await post("ana", "/api/repos/ana/lab/beams", { branch: "nope" })).status).toBe(404);
    expect((await post("ana", "/api/repos/ana/lab/beams", { branch: "main" })).status).toBe(400);
    expect((await post("ana", "/api/repos/ana/lab/beams", { branch: "fix", to: "nobody" })).status).toBe(404);
    expect((await post("ana", "/api/repos/ana/lab/beams", { branch: "fix", onto: "upstream" })).status).toBe(404);   // no such branch yet

    // Only noise: nothing to beam, unless you keep it.
    await sh(`printf 'lockfile\\n' > bun.lock && git add -A && git commit -qm install && git push -q origin fix`, work);
    const empty = await post("ana", "/api/repos/ana/lab/beams", { branch: "fix" });
    expect(empty.status).toBe(409);
    expect((await empty.json() as any).dropped).toEqual([{ path: "bun.lock", why: "a lockfile this repo doesn't use" }]);
    expect((await post("ana", "/api/repos/ana/lab/beams", { branch: "fix", keep: ["bun.lock"] })).status).toBe(201);
    // Not dug from GitHub: no upstream to go onto.
    expect((await post("ana", "/api/repos/ana/lab/beams", { branch: "fix", keep: ["bun.lock"], onto: "upstream" })).status).toBe(409);

    // Main rewrites the line the branch did.
    await sh(`printf 'export const a = 10;\\nexport const b = 2;\\n' > src/a.ts && git commit -qam "a is ten" && git push -q origin fix`, work);
    const other = mkdtempSync(join(root, "main-")), bare = call.artifacts.path("ana--lab");
    await sh(`git clone -q ${bare} . && printf 'export const a = 11;\\nexport const b = 2;\\n' > src/a.ts && git commit -qam "a is eleven"`, other);
    await sh(`git --git-dir ${bare} fetch -q ${other} HEAD && git --git-dir ${bare} update-ref refs/heads/main FETCH_HEAD`);
    const clash = await post("ana", "/api/repos/ana/lab/beams", { branch: "fix" });
    expect(clash.status).toBe(409);
    expect((await clash.json() as any).clash).toEqual(["src/a.ts"]);
    expect((await call(null, "/api/beams/nope")).status).toBe(404);
  });
});

const git = (bare: string, args: string) => sh(`git --git-dir ${bare} ${args} || true`);
