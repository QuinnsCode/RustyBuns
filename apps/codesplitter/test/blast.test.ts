import { describe, expect, test } from "bun:test";
import { blast, flags, isMajor, rank, type Change, type Pkg } from "../scripts/blast.ts";
import { order } from "../scripts/mervin-board.ts";

const pkg = (dir: string, name: string, deps: Record<string, string> = {}): Pkg => ({ dir, name, deps });
const pkgs = [pkg(".", "root"), pkg("packages/util", "@x/util"), pkg("apps/a", "a", { "@x/util": "workspace:*" }), pkg("apps/b", "b"), pkg("apps/c", "c", { a: "workspace:*" })];
const tree = ["apps/a/src/i.ts", "apps/a/test/i.test.ts", "apps/b/src/i.ts", "apps/c/src/i.ts", "packages/util/u.ts", "bun.lock"];
const ch = (pr: number, files: string[], body = "", manifests: Change["manifests"] = []): Change => ({ pr, files, body, manifests });

describe("blast radius", () => {
  test("a workspace reaches itself and its dependents; packages reach everything", () => {
    expect(blast(ch(1, ["apps/b/src/i.ts"]), pkgs, tree).workspaces).toEqual(["apps/b"]);
    const a = blast(ch(2, ["apps/a/src/i.ts"]), pkgs, tree);
    expect(a.workspaces).toEqual(["apps/a", "apps/c"]);
    expect(a.tests).toBe(1);
    const u = blast(ch(3, ["packages/util/u.ts"]), pkgs, tree);
    expect(u.shared).toBe(true);
    expect(u.workspaces).toHaveLength(4);
    expect(blast(ch(4, ["bun.lock"]), pkgs, tree).shared).toBe(true);
  });
  test("major bumps", () => {
    expect(isMajor("^16.0.0", "^17.0.0")).toBe(true);
    expect(isMajor("^1.2.0", "^1.9.0")).toBe(false);
    expect(isMajor("^0.3.1", "^0.4.0")).toBe(true);
    expect(isMajor(null, "^1.0.0")).toBe(false);
  });
  const bump = (to: string) => [{ dir: "apps/b", before: pkg("apps/b", "b", { react: "^16.0.0" }), after: pkg("apps/b", "b", { react: to }) }];
  test("rank puts the widest last, a major bump counts, and order uses it", () => {
    const list = [blast(ch(1, ["packages/util/u.ts"]), pkgs, tree), blast(ch(2, ["apps/b/src/i.ts"], "", bump("^17.0.0")), pkgs, tree), blast(ch(3, ["apps/b/src/i.ts"]), pkgs, tree)];
    expect(rank(list)).toEqual([3, 2, 1]);
    const prs = [1, 2, 3].map((n) => ({ number: n, headRefOid: "", headRefName: `h${n}`, baseRefName: "main" }));
    expect(order(prs, undefined, rank(list)).map((p) => p.number)).toEqual([3, 2, 1]);
  });
  test("flags a major bump without notes and a split bump", () => {
    const cs = [ch(5, ["apps/b/package.json"], "bump react", bump("^17.0.0")), ch(6, ["apps/b/package.json"], "Migration notes: none needed", bump("^18.0.0"))];
    const bs = cs.map((c) => blast(c, pkgs, tree));
    const out = flags(cs, bs);
    expect(out.some((f) => f.startsWith("#5 bumps react ^16.0.0 to ^17.0.0 (major) with no migration notes"))).toBe(true);
    expect(out.some((f) => f.startsWith("#6 bumps"))).toBe(false);
    expect(out.some((f) => f.includes("react is bumped to ^17.0.0 by #5 and ^18.0.0 by #6"))).toBe(true);
  });
});
