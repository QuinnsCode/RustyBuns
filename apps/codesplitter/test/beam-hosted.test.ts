import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatPatch, unifiedDiff, type FileDiff } from "../src/patch.ts";
import { local as boot } from "../src/local.ts";

setDefaultTimeout(30_000);
const root = mkdtempSync(join(tmpdir(), "codesplitter-beam-hosted-"));
writeFileSync(join(root, "gitconfig"), "[user]\n\tname = Ana Real\n\temail = ana@example.com\n[init]\n\tdefaultBranch = main\n");
process.env.GIT_CONFIG_GLOBAL = join(root, "gitconfig");
const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); rmSync(root, { recursive: true, force: true }); });

const sh = async (cmd: string, cwd = root) => {
  const p = Bun.spawn(["sh", "-c", cmd], { cwd, stdout: "pipe", stderr: "pipe", env: process.env });
  const [code, out, err] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  if (code) throw new Error(`${cmd}: ${err}`);
  return out;
};

const lines = (n: number, f = (i: number) => `line ${i}`) => Array.from({ length: n }, (_, i) => f(i + 1)).join("\n") + "\n";

describe("the diff and patch written in JS", () => {
  // Each case is a file before and after (undefined: not there); the diff must be git's, byte for byte.
  const cases: Record<string, [string | undefined, string | undefined]> = {
    "two hunks far apart": [lines(30), lines(30, (i) => i === 3 ? "three" : i === 27 ? "twenty-seven" : `line ${i}`)],
    "two changes close enough to share a hunk": [lines(20), lines(20, (i) => i === 5 || i === 11 ? `changed ${i}` : `line ${i}`)],
    "lines added at the top and the end": [lines(5), `first\n${lines(5)}last\n`],
    "the newline at the end goes": ["a\nb\n", "a\nb"],
    "the newline at the end comes": ["a\nb", "a\nc\n"],
    "a new file": [undefined, "hello\nworld\n"],
    "a new empty file": [undefined, ""],
    "a deleted file": ["bye\n", undefined],
    "a single line, replaced": ["one\n", "two\n"],
  };

  test("is git diff's, byte for byte", async () => {
    const dir = mkdtempSync(join(root, "diff-"));
    await sh("git init -q .", dir);
    const names = Object.keys(cases).map((_, k) => `f${k}.txt`);
    const put = (side: 0 | 1) => {
      for (const [k, c] of Object.values(cases).entries()) {
        const p = join(dir, names[k]!);
        if (c[side] === undefined) rmSync(p, { force: true }); else writeFileSync(p, c[side]!);
      }
    };
    put(0);
    await sh("git add -A && git commit -qm before --allow-empty", dir);
    put(1);
    await sh("git add -A && git commit -qm after", dir);
    const side = async (text: string | undefined, path: string) => text === undefined ? null
      : { hash: (await sh(`git hash-object ${JSON.stringify(path)}`, root).catch(() => "")).trim(), mode: "100644", text };
    const files: FileDiff[] = [];
    for (const [k, [a, b]] of Object.values(cases).entries()) {
      const pa = join(root, `a-${k}`), pb = join(root, `b-${k}`);
      if (a !== undefined) writeFileSync(pa, a);
      if (b !== undefined) writeFileSync(pb, b);
      files.push({ path: names[k]!, before: await side(a, pa), after: await side(b, pb) });
    }
    const theirs = await sh("git diff --no-color HEAD~1 HEAD", dir);
    expect(unifiedDiff(files)).toBe(theirs);
  });

  test("the patch is one git am takes, with its author, date and message", async () => {
    const dir = mkdtempSync(join(root, "am-"));
    await sh("git init -q . && printf 'a\\nb\\n' > x.txt && git add x.txt && git commit -qm base", dir);
    const before = { hash: (await sh("git hash-object x.txt", dir)).trim(), mode: "100644", text: "a\nb\n" };
    writeFileSync(join(root, "after.txt"), "a\nB\n");
    const after = { hash: (await sh(`git hash-object ${join(root, "after.txt")}`)).trim(), mode: "100644", text: "a\nB\n" };
    const diff = unifiedDiff([{ path: "x.txt", before, after }, { path: "new/y.txt", before: null, after: { hash: "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391", mode: "100644", text: "" } }]);
    const patch = formatPatch({ sha: "f".repeat(40), author: { name: "Bo", email: "bo@example.com" }, at: Date.UTC(2026, 9, 12, 16, 0, 0), message: "B is big\n\nBecause.\n\nCo-authored-by: Ana <ana@x>\n" }, diff);
    writeFileSync(join(root, "x.patch"), patch);
    await sh(`git am -q ${join(root, "x.patch")}`, dir);
    expect(await Bun.file(join(dir, "x.txt")).text()).toBe("a\nB\n");
    expect(await sh("git ls-files", dir)).toBe("new/y.txt\nx.txt\n");
    expect(await sh("git log -1 --format='%an <%ae>|%aI|%B'", dir)).toBe("Bo <bo@example.com>|2026-10-12T16:00:00+00:00|B is big\n\nBecause.\n\nCo-authored-by: Ana <ana@x>\n\n");
  });
});

describe("beaming from the hosted site", () => {
  /** The app as Cloudflare runs it: Artifacts, but no git on the machine (mirror.ts localGit is null). */
  async function hosted() {
    const call = await boot();
    opened.push(call);
    const a = call.artifacts;
    call.env.ARTIFACTS = new Proxy(a, { get: (t, k) => k === "path" || k === "stamp" ? undefined : typeof (t as any)[k] === "function" ? (t as any)[k].bind(t) : (t as any)[k] });
    const post = (u: string, url: string, body: unknown, method = "POST") => call(u, url, { method, body: JSON.stringify(body) });
    for (const u of ["ana", "bo"]) await post(u, "/api/login", { name: u });
    expect((await post("ana", "/api/repos", { name: "lab" })).status).toBe(201);
    for (const [path, content] of [["src/a.ts", "export const a = 1;\nexport const b = 2;\n"], ["old.txt", "going\n"], ["keep.md", "stays\n"]]) {
      expect((await post("ana", "/api/repos/ana/lab/files", { path, content })).status).toBeLessThan(300);
      expect((await post("ana", `/api/repos/ana/lab/do/commit?path=${path}`, { message: `add ${path}` })).status).toBe(200);
    }
    expect((await post("ana", "/api/repos/ana/lab/collaborators", { name: "bo" })).status).toBe(200);
    return { call, post, bare: a.path("ana--lab") };
  }

  test("builds the commit with the Worker's git, and writes the diff and patch in JS", async () => {
    const { call, post, bare } = await hosted();
    // Bo opens a branch: a changed line, a new file, a deleted one, and some noise.
    expect((await post("bo", "/api/repos/ana/lab/branches", { name: "tune" })).status).toBe(201);
    const doc = await (await call("bo", "/api/repos/ana/lab/do/file?path=src/a.ts&branch=tune")).json() as any;
    expect((await post("bo", "/api/repos/ana/lab/do/ops?path=src/a.ts&branch=tune", { ops: [{ kind: "set", line: doc.lines[1].id, text: "export const b = 3;", base: doc.lines[1].rev }] })).status).toBe(200);
    for (const [path, content] of [["src/c.ts", "export const c = 1;\n"], [".env.local", "TOKEN=x\n"]])
      expect((await post("bo", "/api/repos/ana/lab/files", { path, content, branch: "tune" })).status).toBe(201);
    expect((await call("bo", "/api/repos/ana/lab/branches/tune/files?path=old.txt", { method: "DELETE" })).status).toBeLessThan(300);
    const main = (await sh(`git --git-dir ${bare} rev-parse main`)).trim();

    // No git branches here: the codeSplitter ones are offered, and a git one is refused.
    const list = await (await call("ana", "/api/repos/ana/lab/beams")).json() as any;
    expect(list).toMatchObject({ branches: [], codesplitter_branches: [{ name: "tune", by: "bo" }], hosted: true });
    expect((await post("ana", "/api/repos/ana/lab/beams", { branch: "tune", kind: "git" })).status).toBe(501);
    expect((await post("ana", "/api/repos/ana/lab/beams", { branch: "tune", onto: "upstream" })).status).toBe(501);
    expect((await post("ana", "/api/repos/ana/lab/beams", { branch: "nope" })).status).toBe(404);

    // codeSplitter is the kind here, without saying so.
    const res = await post("ana", "/api/repos/ana/lab/beams", { branch: "tune", to: "bo" });
    expect(res.status).toBe(201);
    const beam = await res.json() as any;
    expect(beam).toMatchObject({ branch: "tune", kind: "codesplitter", by: "ana", to: "bo", commits: 0, title: "tune, from codeSplitter", onto: { sha: main, label: "main" },
      files: [{ path: "old.txt", status: "D" }, { path: "src/a.ts", status: "M" }, { path: "src/c.ts", status: "A" }],
      dropped: [{ path: ".env.local", why: "an env file: it may hold secrets" }] });
    expect(beam.message).toBe("Co-authored-by: bo <bo@codesplitters.local>");

    // One commit on main's tip, kept at refs/beams/<id> on the Artifacts remote; main didn't move.
    const g = (args: string) => sh(`git --git-dir ${bare} ${args}`).then((s) => s.trim());
    expect(await g(`rev-parse refs/beams/${beam.id}`)).toBe(beam.sha);
    expect(await g(`rev-parse ${beam.sha}^`)).toBe(main);
    expect(await g("rev-parse main")).toBe(main);
    expect(await g(`log -1 --format='%an <%ae>' ${beam.sha}`)).toBe("ana <ana@codesplitters.local>");
    expect(await g(`show ${beam.sha}:src/a.ts`)).toBe("export const a = 1;\nexport const b = 3;");
    expect(await g(`diff --name-status ${main} ${beam.sha}`)).toBe("D\told.txt\nM\tsrc/a.ts\nA\tsrc/c.ts");

    // The page's diff is the one git prints for that commit.
    const page = await (await call(null, `/api/beams/${beam.id}`)).json() as any;
    expect(page.diff).toBe(await sh(`git --git-dir ${bare} diff --no-color ${main} ${beam.sha}`));
    expect(page.diff_truncated).toBe(false);

    // The patch goes onto main with git am, and lands the same tree.
    const patch = await call(null, `/api/beams/${beam.id}/patch`);
    expect(patch.headers.get("content-disposition")).toContain(`beam-${beam.id}.patch`);
    writeFileSync(join(root, "hosted.patch"), await patch.text());
    const them = mkdtempSync(join(root, "them-"));
    await sh(`git clone -q ${bare} . && git am -q ${join(root, "hosted.patch")}`, them);
    expect(await sh("git rev-parse HEAD^{tree}", them)).toBe(await sh(`git --git-dir ${bare} rev-parse ${beam.sha}^{tree}`));
    expect((await sh("git log -1 --format=%s", them)).trim()).toBe("tune, from codeSplitter");

    // Withdrawn: the ref goes from the remote too.
    expect((await call("ana", `/api/beams/${beam.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await g(`rev-parse --verify --quiet refs/beams/${beam.id} || true`)).toBe("");
    expect((await call(null, `/api/beams/${beam.id}/patch`)).status).toBe(410);
  });

  test("refuses a branch main already has, and one that's only noise unless you keep it", async () => {
    const { call, post } = await hosted();
    expect((await post("ana", "/api/repos/ana/lab/branches", { name: "same" })).status).toBe(201);
    // Changed on the branch, then changed back to what main has.
    const doc = await (await call("ana", "/api/repos/ana/lab/do/file?path=keep.md&branch=same")).json() as any;
    expect((await post("ana", "/api/repos/ana/lab/do/ops?path=keep.md&branch=same", { ops: [{ kind: "set", line: doc.lines[0].id, text: "moved", base: doc.lines[0].rev }] })).status).toBe(200);
    const moved = await (await call("ana", "/api/repos/ana/lab/do/file?path=keep.md&branch=same")).json() as any;
    expect((await post("ana", "/api/repos/ana/lab/do/ops?path=keep.md&branch=same", { ops: [{ kind: "set", line: moved.lines[0].id, text: "stays", base: moved.lines[0].rev }] })).status).toBe(200);
    expect((await post("ana", "/api/repos/ana/lab/beams", { branch: "same" })).status).toBe(409);

    expect((await post("ana", "/api/repos/ana/lab/branches", { name: "noise" })).status).toBe(201);
    expect((await post("ana", "/api/repos/ana/lab/files", { path: "debug.log", content: "x\n", branch: "noise" })).status).toBe(201);
    const empty = await post("ana", "/api/repos/ana/lab/beams", { branch: "noise" });
    expect(empty.status).toBe(409);
    expect((await empty.json() as any).dropped).toEqual([{ path: "debug.log", why: "an editor, log or patch leftover" }]);
    const kept = await post("ana", "/api/repos/ana/lab/beams", { branch: "noise", keep: ["debug.log"], title: "Keep the log" });
    expect(kept.status).toBe(201);
    expect(await kept.json()).toMatchObject({ title: "Keep the log", files: [{ path: "debug.log", status: "A" }], dropped: [] });
    expect((await (await call(null, `/api/beams/${(await (await call("ana", "/api/repos/ana/lab/beams")).json() as any).beams[0].id}`)).json() as any).diff)
      .toContain("+++ b/debug.log\n@@ -0,0 +1 @@\n+x\n");
  });
});
