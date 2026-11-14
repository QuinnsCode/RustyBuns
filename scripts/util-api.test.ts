import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dropped, sideProblems } from "./util-api.ts";

const manifest = { stable: ["a"], shared: ["a", "b"], web: ["w"], server: ["s"] };
const mods = (extra: Record<string, string>) =>
  new Map(Object.entries({ a: "export const a = 1;", b: "export const b = 2;", w: "", s: "", ...extra }));

test("imports that go the wrong way, and a module with no side, are named", () => {
  const cases: [Record<string, string>, string][] = [
    [{ b: 'import { w } from "./w.ts";' }, "b.ts is shared but imports w (web)"],
    [{ b: 'import { x } from "node:fs";' }, "b.ts is shared but imports node:fs"],
    [{ w: 'import { s } from "./s.ts";' }, "w.ts is web but imports s (server)"],
    [{ s: 'export { w } from "./w.ts";' }, "s.ts is server but imports w (web)"],
    [{ w: 'import { idea } from "./lab/idea.ts";' }, "only lab may import lab"],
    [{ a: 'export * from "./b.ts";' }, "so b is stable too"],
    [{ extra: "" }, "src/extra.ts has no side"],
  ];
  for (const [extra, want] of cases) expect(sideProblems(manifest, mods(extra)).join("\n")).toContain(want);
  expect(sideProblems(manifest, mods({ w: 'import { a } from "./a.ts";\nimport { ui } from "@rustybuns/ui";', s: 'import { b } from "./b.ts";' }))).toEqual([]);
});

test("a stable export that changed or went away is a break; a new one is not", () => {
  const before = "## guard\nconst str = (max = 1000): Guard<string> =>\nconst num = (lo: number, hi: number): Guard<number> =>\n";
  const after = "## guard\nconst str = (max = 2000): Guard<string> =>\nconst num = (lo: number, hi: number): Guard<number> =>\nconst isRecord = (v: unknown) =>\n";
  expect(dropped(before, after)).toEqual(["guard: const str = (max = 1000): Guard<string> =>"]);
  expect(dropped(after, after)).toEqual([]);
});

test("a shared module copies out with what it imports, and works on its own", async () => {
  const dir = mkdtempSync(join(tmpdir(), "util-copy-"));
  const run = Bun.spawnSync(["bun", join(import.meta.dir, "util-api.ts"), "--copy", "http", dir]);
  expect(run.exitCode).toBe(0);
  expect(readdirSync(dir).sort()).toEqual(["guard.ts", "http.ts"]);
  const { json } = await import(join(dir, "http.ts"));
  const res: Response = json({ ok: true });
  expect(await res.json()).toEqual({ ok: true });
  expect(Bun.spawnSync(["bun", join(import.meta.dir, "util-api.ts"), "--copy", "dom", dir]).exitCode).toBe(1);
});
