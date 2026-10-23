import { expect, test } from "bun:test";
import { local as boot } from "./app-kit.ts";

// A client's body is checked field by field (env.ts readBody): the wrong shape is a 4xx, never a 500.

test("wrong-shaped bodies are turned away, not thrown on", async () => {
  const call = await boot({ GH_CLI: "off" });
  const send = (url: string, body: string, method = "POST") => call("ana", url, { method, body });
  await send("/api/login", JSON.stringify({ name: "ana" }));
  await send("/api/repos", JSON.stringify({ name: "pub" }));

  const bad: [string, string, string?][] = [
    ["/api/login", JSON.stringify({ name: ["ana"] })],
    ["/api/repos", "null"],
    ["/api/repos", JSON.stringify({ name: ["pub2"] })],
    ["/api/repos/ana/pub/files", JSON.stringify({ path: "b.ts", content: 5 })],
    ["/api/repos/ana/pub/files", JSON.stringify({ path: ["b.ts"] })],
    ["/api/repos/ana/pub/branches", JSON.stringify({ name: 5 })],
    ["/api/repos/ana/pub/stamps", "null"],
    ["/api/repos/ana/pub/checks", JSON.stringify({ ref: ["main"], sha: "abc", name: "unit" })],
    ["/api/repos/ana/pub/checks", JSON.stringify({ ref: "main", sha: "abc", name: "unit", url: {} })],
    ["/api/playlists", JSON.stringify({ title: 5 })],
    ["/api/repos/ana/pub/deploy", JSON.stringify({ stage: ["prod"] }), "PUT"],
    ["/api/repos/ana/pub/branches", "{not json"],
    ["/api/repos/ana/pub/branches", JSON.stringify({ name: "x", parent: 5 })],
    ["/api/repos/ana/pub/merges", JSON.stringify({ branches: [5] })],
    ["/api/repos/ana/pub/pushes", JSON.stringify({ path: 5, take: "mine" })],
    ["/api/repos/ana/pub/deps", JSON.stringify({ max_level: 5 }), "PUT"],
    // The file itself (file-do.ts) checks what reaches it, over HTTP as over the socket.
    ["/api/repos/ana/pub/do/ops?path=b.ts", JSON.stringify({ ops: { kind: "insert" } })],
    ["/api/repos/ana/pub/do/ops?path=b.ts", JSON.stringify({ ops: [{ kind: "insert", after: null, text: 5 }] })],
    ["/api/repos/ana/pub/do/ops?path=b.ts", JSON.stringify({ ops: [{ kind: "insert", after: null, text: "two\nlines" }] })],
    ["/api/repos/ana/pub/do/ops?path=b.ts", JSON.stringify({ ops: [{ kind: "explode", line: "L1", base: 1 }] })],
    ["/api/repos/ana/pub/do/ops?path=b.ts", JSON.stringify({ ops: [{ kind: "set", line: "L1", base: "1", text: "x" }] })],
    ["/api/repos/ana/pub/do/ops?path=b.ts", JSON.stringify({ ops: [], ifRev: "3" })],
    ["/api/repos/ana/pub/do/claims?path=b.ts", JSON.stringify({ lines: "L1", task: "x" })],
    ["/api/repos/ana/pub/do/claims?path=b.ts", JSON.stringify({ lines: ["L1"], task: ["x"] })],
    ["/api/repos/ana/pub/do/claims?path=b.ts", "[]"],
    ["/api/repos/ana/pub/do/private?path=b.ts", JSON.stringify({ lines: "L1", private: true })],
    ["/api/me", JSON.stringify({ bio: "x".repeat(1001) }), "PUT"],
    ["/api/repos/ana/pub/board", JSON.stringify({ main: "abc", prs: [], hits: { t: "x".repeat(4000) } })],
  ];
  for (const [url, body, method] of bad) {
    const r = await send(url, body, method);
    expect([url, body, r.status >= 400 && r.status < 500]).toEqual([url, body, true]);
  }

  // A commit message that isn't text is no message; one that's too long is cut, not stored whole.
  await send("/api/repos/ana/pub/files", JSON.stringify({ path: "b.ts", content: "first" }));
  const file = (await (await send("/api/repos/ana/pub/do/file?path=b.ts", "", "GET")).json()) as { lines: { id: string; rev: number }[] };
  expect((await send("/api/repos/ana/pub/do/ops?path=b.ts", JSON.stringify({ ops: [{ kind: "set", line: file.lines[0]!.id, base: file.lines[0]!.rev, text: "one" }] }))).status).toBe(200);
  const made = (await (await send("/api/repos/ana/pub/do/commit?path=b.ts", JSON.stringify({ message: { not: "text" } }))).json()) as { message: string };
  expect(made.message).toBe("commit");
  const long = (await (await send("/api/repos/ana/pub/do/commit?path=b.ts", JSON.stringify({ message: "m".repeat(5000) }))).json()) as { message: string };
  expect(long.message).toHaveLength(1000);

  // A merge's resolve that isn't a map of picks settles nothing, and the merge goes on.
  await send("/api/repos/ana/pub/branches", JSON.stringify({ name: "fix" }));
  await send("/api/repos/ana/pub/files", JSON.stringify({ path: "c.ts", content: "one", branch: "fix" }));
  expect((await send("/api/repos/ana/pub/branches/fix/merge", JSON.stringify({ resolve: null }))).status).toBe(200);
});
