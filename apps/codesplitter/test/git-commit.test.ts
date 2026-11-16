import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { local as boot } from "../src/local.ts";

setDefaultTimeout(30_000);
const root = mkdtempSync(join(tmpdir(), "codesplitter-commit-"));
writeFileSync(join(root, "gitconfig"), "[user]\n\tname = Ana Real\n\temail = ana@example.com\n[init]\n\tdefaultBranch = main\n");
process.env.GIT_CONFIG_GLOBAL = join(root, "gitconfig");
const call = await boot();
afterAll(() => { call.close(); rmSync(root, { recursive: true, force: true }); });

test("committing a file git already has as it is makes no git commit", async () => {
  const post = (url: string, body: unknown) => call("ana", url, { method: "POST", body: JSON.stringify(body) });
  await post("/api/login", { name: "ana" });
  expect((await post("/api/repos", { name: "lab" })).status).toBe(201);
  expect((await post("/api/repos/ana/lab/files", { path: "a.ts", content: "export const a = 1;\n" })).status).toBeLessThan(300);
  expect((await post("/api/repos/ana/lab/do/commit?path=a.ts", { message: "add a" })).status).toBe(200);
  const log = async () => {
    const p = Bun.spawn(["git", "--git-dir", call.artifacts.path("ana--lab"), "log", "--format=%s", "main"], { stdout: "pipe" });
    return (await new Response(p.stdout).text()).trim().split("\n");
  };
  const before = await log();
  expect(before[0]).toBe("add a");
  expect((await post("/api/repos/ana/lab/do/commit?path=a.ts", { message: "again" })).status).toBe(200);
  expect(await log()).toEqual(before);
});
