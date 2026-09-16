import { test, expect } from "bun:test";
import { d1, kv, storage, serve } from "../src/index.ts";

test("d1 adapter: prepare/bind/all/first/run", async () => {
  const db = d1(":memory:");
  await db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
  const r = await db.prepare("INSERT INTO users (name) VALUES (?)").bind("ada").run();
  expect(r.meta.last_row_id).toBe(1);
  const all = await db.prepare("SELECT * FROM users").all();
  expect(all.results).toEqual([{ id: 1, name: "ada" }]);
  expect(await db.prepare("SELECT name FROM users WHERE id = ?").bind(1).first("name")).toBe("ada");
});

test("kv adapter: ttl and list", async () => {
  const ns = kv(":memory:");
  await ns.put("a:1", "x", { metadata: { n: 1 } });
  await ns.put("a:2", "y", { expirationTtl: 1 });
  await ns.put("b:1", "z");
  expect(await ns.get("a:1")).toBe("x");
  const l = await ns.list({ prefix: "a:" });
  expect(l.keys.map((k) => k.name)).toEqual(["a:1", "a:2"]);
  expect(l.keys[0]!.metadata).toEqual({ n: 1 });
});

test("storage port: DO shape", async () => {
  const s = storage(":memory:");
  await s.put("sceneId", "hub");
  await s.put("unlocks", ["a"]);
  expect(await s.get("sceneId")).toBe("hub");
  expect((await s.list({ prefix: "s" })).get("sceneId")).toBe("hub");
  expect(await s.delete("sceneId")).toBe(true);
});

test("serve: token gate, worker fetch, websocket round trip", async () => {
  const shell = serve<{ KV: ReturnType<typeof kv> }>({ token: "t0k" });
  const env = { KV: kv(":memory:") };
  shell.mount({ async fetch(req, e) { await e.KV.put("hit", "1"); return new Response("hi " + new URL(req.url).pathname); } }, env);
  shell.comms.websocket("/ws", {
    message: (ws, d) => ws.send("echo:" + d),
    close: () => {},
  });

  expect((await fetch(shell.url + "/x")).status).toBe(403);
  const r = await fetch(shell.url + "/x?token=t0k", { redirect: "manual" });
  expect(r.status).toBe(302);
  const cookie = r.headers.get("set-cookie")!;
  const ok = await fetch(shell.url + "/x", { headers: { cookie } });
  expect(await ok.text()).toBe("hi /x");
  expect(ok.headers.get("cross-origin-opener-policy")).toBe("same-origin");
  expect(await env.KV.get("hit")).toBe("1");

  const ws = new WebSocket(shell.url.replace("http", "ws") + "/ws", { headers: { cookie } } as any);
  const got = await new Promise<string>((res) => {
    ws.onopen = () => ws.send("ping");
    ws.onmessage = (m) => res(String(m.data));
  });
  expect(got).toBe("echo:ping");
  ws.close();
  await shell.stop();
});
