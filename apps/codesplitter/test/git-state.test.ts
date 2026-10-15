import { expect, test } from "bun:test";
import { local as boot } from "./app-kit.ts";

test("git-state counts files with edits no commit has taken, and clears them on commit", async () => {
  const call = await boot({ GH_CLI: "off" });
  const send = (url: string, body: unknown, method = "POST") => call("ryan", url, { method, body: JSON.stringify(body) });
  const state = async () => (await call("ryan", "/api/repos/ryan/lab/git-state")).json() as Promise<any>;
  await send("/api/login", { name: "ryan" });
  await send("/api/repos", { name: "lab", visibility: "public" });
  await send("/api/repos/ryan/lab/files", { path: "a.ts", content: "one" });
  await send("/api/repos/ryan/lab/files", { path: "b.ts", content: "two" });
  let g: any;
  for (const end = performance.now() + 5000; performance.now() < end;) { g = await state(); if (g.uncommitted.count === 2) break; await Bun.sleep(20); }
  expect(g.uncommitted.count).toBe(2);
  expect(g.uncommitted.files.map((f: any) => f.path).sort()).toEqual(["a.ts", "b.ts"]);
  expect(g.mirror).toBeNull();
  expect(g.conflicts).toEqual({ mirror: null, push: [] });

  expect((await send("/api/repos/ryan/lab/do/commit?path=a.ts", { message: "a" })).status).toBe(200);
  g = await state();
  expect(g.uncommitted.files.map((f: any) => f.path)).toEqual(["b.ts"]);
});
