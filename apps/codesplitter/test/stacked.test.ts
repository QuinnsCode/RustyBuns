import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { restack } from "../src/branches.ts";
import { apply, fromText, empty, text, type Doc } from "../src/lines.ts";
import { local as boot } from "../src/local.ts";

// Branches stacked on branches (#1025): B opened on A forks from A's copies, waits for A to merge, then merges into main.
setDefaultTimeout(30_000);
const root = mkdtempSync(join(tmpdir(), "codesplitter-stacked-"));
writeFileSync(join(root, "gitconfig"), "[user]\n\tname = Ana Real\n\temail = ana@example.com\n[init]\n\tdefaultBranch = main\n");
process.env.GIT_CONFIG_GLOBAL = join(root, "gitconfig");
const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); rmSync(root, { recursive: true, force: true }); });

const doc = (t: string, by = "ana") => { const d = empty(); apply(d, fromText(t), by); return d; };
const edit = (d: Doc, next: string) => {
  const out = structuredClone(d), lines = next.split("\n");
  // Same length here: a set per changed line, ids kept, as an edit on a copy does.
  apply(out, lines.flatMap((t, i) => out.lines[i]!.text === t ? [] : [{ kind: "set" as const, line: out.lines[i]!.id, text: t, base: out.lines[i]!.rev }]), "bo");
  return out;
};

describe("restack", () => {
  test("moves a copy's changes onto main's file, matching lines by text when main gave them other ids", () => {
    const base = doc("a\nb\nc"), copy = edit(base, "a\nB\nc");
    // Main has the same text with its own ids (the merge of the branch under it), and a line of its own.
    const onto = doc("x\na\nb\nc");
    const r = restack(base, copy, onto, "bo", "f.txt")!;
    const d = structuredClone(onto);
    expect(apply(d, r.ops, r.by).ok).toBe(true);
    expect(text(d)).toBe("x\na\nB\nc");
  });

  test("the copy's line wins where main changed it too", () => {
    const base = doc("a\nb"), copy = edit(base, "a\nmine"), onto = doc("a\ntheirs");
    const r = restack(base, copy, onto, "bo", "f.txt")!, d = structuredClone(onto);
    apply(d, r.ops, r.by);
    expect(text(d)).toBe("a\nmine");
  });
});

describe("a branch on a branch", () => {
  async function lab() {
    const call = await boot();
    opened.push(call);
    const post = (u: string, url: string, body: unknown) => call(u, url, { method: "POST", body: JSON.stringify(body) });
    await post("ana", "/api/login", { name: "ana" });
    expect((await post("ana", "/api/repos", { name: "lab" })).status).toBe(201);
    expect((await post("ana", "/api/repos/ana/lab/files", { path: "a.ts", content: "export const a = 1;\nexport const b = 2;\nexport const c = 3;" })).status).toBe(201);
    const file = async (branch?: string) => await (await call("ana", `/api/repos/ana/lab/do/file?path=a.ts${branch ? `&branch=${branch}` : ""}`)).json() as Doc;
    const set = async (branch: string | null, i: number, t: string) => {
      const d = await file(branch ?? undefined), l = d.lines[i]!;
      expect((await post("ana", `/api/repos/ana/lab/do/ops?path=a.ts${branch ? `&branch=${branch}` : ""}`, { ops: [{ kind: "set", line: l.id, text: t, base: l.rev }] })).status).toBe(200);
    };
    return { call, post, file, set };
  }

  test("forks from the copy under it, waits for it, then merges onto main with main's own changes kept", async () => {
    const { call, post, file, set } = await lab();
    expect((await post("ana", "/api/repos/ana/lab/branches", { name: "b", parent: "nope" })).status).toBe(404);
    expect((await post("ana", "/api/repos/ana/lab/branches", { name: "a" })).status).toBe(201);
    await set("a", 0, "export const a = 10;");
    expect(await (await post("ana", "/api/repos/ana/lab/branches", { name: "b", parent: "a" })).json()).toMatchObject({ name: "b", parent: "a" });
    // B sees A's change, and adds its own.
    expect(text(await file("b"))).toBe("export const a = 10;\nexport const b = 2;\nexport const c = 3;");
    await set("b", 1, "export const b = 20;");
    // A file new on A is one B can't make again, and can open.
    expect((await post("ana", "/api/repos/ana/lab/files", { path: "n.ts", content: "new", branch: "a" })).status).toBe(201);
    expect((await post("ana", "/api/repos/ana/lab/files", { path: "n.ts", content: "again", branch: "b" })).status).toBe(409);
    expect(text(await (await call("ana", "/api/repos/ana/lab/do/file?path=n.ts&branch=b")).json() as Doc)).toBe("new");
    // Main moves too.
    await set(null, 2, "export const c = 30;");

    const merge = (b: string) => post("ana", `/api/repos/ana/lab/branches/${b}/merge`, {});
    const held = await merge("b");
    expect(held.status).toBe(409);
    expect((await held.json() as any).error).toBe("b is stacked on a: merge a first");
    expect((await merge("a")).status).toBe(200);
    expect((await merge("b")).status).toBe(200);
    expect(text(await file())).toBe("export const a = 10;\nexport const b = 20;\nexport const c = 30;");
    expect(text(await (await call("ana", "/api/repos/ana/lab/do/file?path=n.ts")).json() as Doc)).toBe("new");
  });

  test("lists the files the branch under it made and deleted, its own rows winning (#1039)", async () => {
    const { call, post } = await lab();
    await post("ana", "/api/repos/ana/lab/files", { path: "old.ts", content: "old" });
    await post("ana", "/api/repos/ana/lab/branches", { name: "a" });
    await post("ana", "/api/repos/ana/lab/branches", { name: "b", parent: "a" });
    const tree = async (branch?: string) => ((await (await call("ana", `/api/repos/ana/lab/tree?path=${branch ? `&branch=${branch}` : ""}`)).json()) as any).entries.map((e: any) => e.path).sort();
    expect(await tree("b")).toEqual(["a.ts", "old.ts"]);
    expect((await post("ana", "/api/repos/ana/lab/files", { path: "n.ts", content: "new", branch: "a" })).status).toBe(201);
    expect((await call("ana", "/api/repos/ana/lab/branches/a/files?path=old.ts", { method: "DELETE" })).status).toBe(200);
    expect(await tree("b")).toEqual(["a.ts", "n.ts"]);
    // B deleting A's new file wins over A having it.
    expect((await call("ana", "/api/repos/ana/lab/branches/b/files?path=n.ts", { method: "DELETE" })).status).toBe(200);
    expect(await tree("b")).toEqual(["a.ts"]);
    expect(await tree("a")).toEqual(["a.ts", "n.ts"]);
    expect(await tree()).toEqual(["a.ts", "old.ts"]);
  });

  test("merges oldest first in one go, the one under it first", async () => {
    const { post, file, set } = await lab();
    await post("ana", "/api/repos/ana/lab/branches", { name: "a" });
    await set("a", 0, "export const a = 10;");
    await post("ana", "/api/repos/ana/lab/branches", { name: "b", parent: "a" });
    await set("b", 0, "export const a = 100;");
    const out = await (await post("ana", "/api/repos/ana/lab/merges", {})).json() as any;
    expect(out).toEqual({ merged: ["a", "b"], skipped: [] });
    expect(text(await file())).toBe("export const a = 100;\nexport const b = 2;\nexport const c = 3;");
  });
});
