// A release swaps the Worker and restarts every Durable Object. What someone's agent wrote before it
// has to be there after: same lines, same revs, the log, and the file still takes edits.
import { expect, test } from "bun:test";
import { local, post as postTo } from "./app-kit.ts";

test("lines an agent added survive a release that restarts every object, and the file keeps taking edits", async () => {
  const call = await local({ GH_CLI: "off" });
  const post = (user: string, url: string, body: unknown) => postTo(call, user, url, body);
  const file = async () => (await (await call("ryan", "/api/repos/ryan/lab/do/file?path=a.js")).json()) as { rev: number; lines: { id: string; rev: number; text: string }[] };
  const ops = (ops: unknown[]) => post("ryan", "/api/repos/ryan/lab/do/ops?path=a.js", { ops });

  await post("ryan", "/api/login", { name: "ryan" });
  await post("ryan", "/api/repos", { name: "lab", visibility: "public" });
  await post("ryan", "/api/repos/ryan/lab/files", { path: "a.js", content: "let a = 1" });

  // The agent works: three more lines, then a rewrite of the first.
  const first = (await file()).lines[0]!;
  for (const text of ["let b = 2", "let c = 3", "let d = 4"]) expect((await ops([{ kind: "insert", after: null, text }])).status).toBe(200);
  expect((await ops([{ kind: "set", line: first.id, base: first.rev, text: "let a = 10" }])).status).toBe(200);
  const before = await file();
  expect(before.lines.map((l) => l.text).sort()).toEqual(["let a = 10", "let b = 2", "let c = 3", "let d = 4"]);

  // The release: the file's object is dropped, the way a deploy drops it, and built again on its storage.
  expect(call.env.FILES.evict(call.env.FILES.idFromName("ryan/lab/a.js"))).toBe(true);

  // Nothing is missing or reordered, and the log still reaches back.
  expect(await file()).toEqual(before);
  expect((await ops([{ kind: "insert", after: null, text: "let e = 5" }])).status).toBe(200);
  expect((await file()).lines.length).toBe(5);
});
