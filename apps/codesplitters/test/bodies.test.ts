import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";

// A client's body is checked field by field (env.ts readBody): the wrong shape is a 4xx, never a 500.
setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

test("wrong-shaped bodies are turned away, not thrown on", async () => {
  const call = await boot({ GH_CLI: "off" });
  opened.push(call);
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
  ];
  for (const [url, body, method] of bad) {
    const r = await send(url, body, method);
    expect([url, body, r.status >= 400 && r.status < 500]).toEqual([url, body, true]);
  }

  // A merge's resolve that isn't a map of picks settles nothing, and the merge goes on.
  await send("/api/repos/ana/pub/branches", JSON.stringify({ name: "fix" }));
  await send("/api/repos/ana/pub/files", JSON.stringify({ path: "c.ts", content: "one", branch: "fix" }));
  expect((await send("/api/repos/ana/pub/branches/fix/merge", JSON.stringify({ resolve: null }))).status).toBe(200);
});
