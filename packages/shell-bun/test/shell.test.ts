import { test, expect } from "bun:test";
import { d1, kv, storage, serve } from "../src/index.ts";

test("d1 adapter: prepare/bind/all/first/run", async () => {
  const db = d1(":memory:");
  await db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
  const r = await db.prepare("INSERT INTO users (name) VALUES (?)").bind("ada").run();
  expect(r.meta.last_row_id).toBe(1);
  const all = await db.prepare("SELECT * FROM users").all();
  expect(all.results).toEqual([{ id: 1, name: "ada" }]);
  expect(await db.prepare("SELECT name FROM users WHERE id = ?").bind(1).first<string>("name")).toBe("ada");
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
  expect(await s.get<string>("sceneId")).toBe("hub");
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

test("storage v8 codec keeps TypedArrays and Maps", async () => {
  const s = storage(":memory:", { codec: "v8" });
  await s.put("pos", new Float32Array([1.5, 2.5]));
  await s.put("m", new Map([["a", 1]]));
  expect(await s.get<Float32Array>("pos")).toBeInstanceOf(Float32Array);
  expect((await s.get<Map<string, number>>("m"))!.get("a")).toBe(1);
  const j = storage(":memory:");
  await j.put("pos", new Float32Array([1.5]));
  expect(await j.get<Record<string, number>>("pos")).toEqual({ "0": 1.5 });   // the silent JSON degradation, documented
});

test("D1 migrations apply once and are tracked", async () => {
  const { applyD1Migrations } = await import("../src/index.ts");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const dir = mkdtempSync("/tmp/mig-");
  writeFileSync(`${dir}/0001_init.sql`, "CREATE TABLE world_progress (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, world_slug TEXT NOT NULL, UNIQUE(user_id, world_slug));");
  writeFileSync(`${dir}/0002_unlocks.sql`, "CREATE TABLE world_unlocks (id TEXT PRIMARY KEY, world_slug TEXT, key TEXT, UNIQUE(world_slug, key));");
  const db = d1(":memory:");
  expect(await applyD1Migrations(db, dir)).toEqual(["0001_init.sql", "0002_unlocks.sql"]);
  expect(await applyD1Migrations(db, dir)).toEqual([]);
  // the ON CONFLICT target your comment warns about now exists
  await db.prepare("INSERT INTO world_progress (id,user_id,world_slug) VALUES (?,?,?) ON CONFLICT(user_id, world_slug) DO UPDATE SET id=excluded.id").bind("1", "u", "w").run();
});

test("r2 over a directory: put/get/head/list/delete + mount serving", async () => {
  const { r2, serve: mk } = await import("../src/index.ts");
  const { mkdtempSync } = await import("node:fs");
  const dir = mkdtempSync("/tmp/r2-");
  const b = r2(dir);
  await b.put("models/tree.abc123.glb", new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: "model/gltf-binary" } });
  await b.put("models/rock.glb", "rock");
  const o = await b.get("models/tree.abc123.glb");
  expect(o!.size).toBe(3);
  expect(o!.httpMetadata.contentType).toBe("model/gltf-binary");
  expect((await b.list({ prefix: "models/" })).objects.map((x) => x.key)).toEqual(["models/rock.glb", "models/tree.abc123.glb"]);
  expect(await b.head("nope")).toBeNull();
  const shell = mk({ mounts: { "/asset": dir } });
  const r = await fetch(shell.url + "/asset/models/rock.glb");
  expect(await r.text()).toBe("rock");
  expect((await fetch(shell.url + "/asset/missing")).status).toBe(404);
  await b.delete("models/rock.glb");
  expect(await b.head("models/rock.glb")).toBeNull();
  await shell.stop();
});

test("r2 overlay: read-only base, writable overlay, tombstones", async () => {
  const { r2 } = await import("../src/index.ts");
  const { mkdtempSync, writeFileSync, chmodSync } = await import("node:fs");
  const base = mkdtempSync("/tmp/r2base-"), over = mkdtempSync("/tmp/r2over-");
  writeFileSync(base + "/shipped.glb", "SHIPPED");
  chmodSync(base, 0o555);
  const b = r2(base, over);
  expect(await (await b.get("shipped.glb"))!.text()).toBe("SHIPPED");
  await b.put("new.bin", "NEW");
  expect((await b.list()).objects.map((o) => o.key).sort()).toEqual(["new.bin", "shipped.glb"]);
  await b.delete("shipped.glb");
  expect(await b.head("shipped.glb")).toBeNull();
  expect((await b.list()).objects.map((o) => o.key)).toEqual(["new.bin"]);
  chmodSync(base, 0o755);
});

test("serve: guests reach only the listed path, with a passphrase and no redirect; principal is vouched", async () => {
  let pass: string | undefined;
  const shell = serve({ token: "t0k", guest: { paths: ["/ws"], passphrase: () => pass } });
  const seen: string[] = [];
  shell.mount({ async fetch(req) { seen.push(req.headers.get("x-rb-principal")!); return new Response("ok"); } }, {});
  shell.comms.websocket("/ws", { message: (ws, d) => ws.send("echo:" + d), close: () => {} });
  shell.comms.websocket("/other", { message: (ws, d) => ws.send(d), close: () => {} });

  const wsStatus = (path: string, headers: Record<string, string> = {}) => new Promise<"open" | "closed">((res) => {
    const ws = new WebSocket(shell.url.replace("http", "ws") + path, { headers } as any);
    ws.onopen = () => { ws.close(); res("open"); };
    ws.onerror = () => res("closed"); ws.onclose = () => res("closed");
  });
  // closed until the host sets a passphrase
  expect(await wsStatus("/ws?join=secret")).toBe("closed");
  pass = "secret";
  expect(await wsStatus("/ws?join=wrong")).toBe("closed");
  expect(await wsStatus("/ws?join=secret")).toBe("open");
  expect(await wsStatus("/other?join=secret")).toBe("closed");       // not a guest path
  expect((await fetch(shell.url + "/x?join=secret")).status).toBe(403);   // nor is anything else
  expect((await fetch(shell.url + "/__rb/action?join=secret", { method: "POST" })).status).toBe(403);
  // the host's own cookie still wins on the guest path, and the client cannot forge the principal
  const cookie = (await fetch(shell.url + "/x?token=t0k", { redirect: "manual" })).headers.get("set-cookie")!;
  expect(cookie).toMatch(/^rb_token_\d+=t0k/);
  await fetch(shell.url + "/x", { headers: { cookie, "x-rb-principal": "guest" } });
  expect(seen).toEqual(["host"]);
  pass = undefined;
  expect(await wsStatus("/ws?join=secret")).toBe("closed");
  await shell.stop();
});

test("serve: rebind keeps the port and the open sockets", async () => {
  const shell = serve({});
  shell.comms.websocket("/ws", { message: (ws, d) => ws.send("echo:" + d), close: () => {} });
  const port = shell.port;
  expect(shell.hostname).toBe("127.0.0.1");
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((r) => (ws.onopen = r));
  expect(shell.rebind({ hostname: "0.0.0.0" })).toEqual({ hostname: "0.0.0.0", port });
  expect(shell.url).toBe(`http://0.0.0.0:${port}`);
  const got = new Promise<string>((res) => (ws.onmessage = (m) => res(String(m.data))));
  ws.send("hi");
  expect(await got).toBe("echo:hi");            // the pre-rebind socket is still served
  const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((r) => (ws2.onopen = r));   // and loopback still answers on the new listener
  ws.close(); ws2.close();
  await shell.stop();
});

test("serve: another local page's request carries the cookie but not our Origin, and is refused", async () => {
  const shell = serve({ token: "t0k" });
  shell.mount({ async fetch() { return new Response("ok"); } }, {});
  const cookie = (await fetch(shell.url + "/x?token=t0k", { redirect: "manual" })).headers.get("set-cookie")!;
  const post = (origin?: string) => fetch(shell.url + "/__rb/action", { method: "POST", headers: { cookie, ...(origin ? { origin } : {}) }, body: "{}" });
  expect((await post("http://127.0.0.1:1")).status).toBe(403);   // same site to SameSite, another port
  expect((await post("null")).status).toBe(403);                  // a sandboxed frame
  expect((await post(shell.url)).status).toBe(200);
  expect((await post()).status).toBe(200);                        // not a browser: no Origin, cookie still needed
  await shell.stop();
});

test("paths stay inside their root, not just under a name that starts the same", async () => {
  const { r2, serve: mk } = await import("../src/index.ts");
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { basename, join } = await import("node:path");
  const dir = mkdtempSync("/tmp/r2-");
  const sibling = dir + "-old";
  mkdirSync(sibling);
  writeFileSync(join(sibling, "secret"), "s");
  const escape = `../${basename(dir)}-old/secret`;
  await expect(r2(dir).get(escape)).rejects.toThrow("bad key");
  const shell = mk({ mounts: { "/asset": dir }, assets: dir });
  for (const p of ["/asset/", "/"]) expect(await (await fetch(shell.url + p + encodeURIComponent(escape))).text()).not.toBe("s");
  await shell.stop();
});

test("serve: a launch code trades for the cookie once, and expires", async () => {
  const shell = serve({ token: "t0k" });
  shell.mount({ async fetch() { return new Response("in"); } }, {});
  const code = shell.launchCode()!;
  const r = await fetch(shell.url + "/x?rb_launch=" + code + "&a=1", { redirect: "manual" });
  expect(r.status).toBe(302);
  expect(r.headers.get("location")).toBe("/x?a=1");
  const cookie = r.headers.get("set-cookie")!;
  expect(cookie).toContain("=t0k;");
  expect(await (await fetch(shell.url + "/x", { headers: { cookie } })).text()).toBe("in");
  expect((await fetch(shell.url + "/x?rb_launch=" + code, { redirect: "manual" })).status).toBe(403);   // used up
  const stale = shell.launchCode(1)!;
  await Bun.sleep(5);
  expect((await fetch(shell.url + "/x?rb_launch=" + stale, { redirect: "manual" })).status).toBe(403);
  expect((await fetch(shell.url + "/x?rb_launch=nope", { redirect: "manual" })).status).toBe(403);
  await shell.stop();
  expect(serve({}).launchCode()).toBeUndefined();
});

test("serve: _headers and .assetsignore stay unserved, and _headers rules apply to assets", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dir = mkdtempSync("/tmp/rb-assets-");
  mkdirSync(join(dir, "_astro"));
  writeFileSync(join(dir, "_astro", "app.abc123.js"), "x");
  writeFileSync(join(dir, "index.html"), "<p>hi</p>");
  writeFileSync(join(dir, ".assetsignore"), "_worker.js\n");
  writeFileSync(join(dir, "_headers"), [
    "# Astro",
    "/_astro/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "/:page.html",
    "  X-Page: yes",
    "  ! Cross-Origin-Embedder-Policy",
    "https://example.com/*",
    "  X-Never: 1",
  ].join("\n"));
  const shell = serve({ assets: dir });
  shell.mount({ async fetch() { return new Response("worker", { status: 404 }); } }, {});
  for (const p of ["/_headers", "/.assetsignore"]) expect(await (await fetch(shell.url + p)).text()).toBe("worker");
  const js = await fetch(shell.url + "/_astro/app.abc123.js");
  expect(js.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  expect(js.headers.get("content-type")).toContain("javascript");
  expect(js.headers.get("x-never")).toBeNull();
  const page = await fetch(shell.url + "/index.html");
  expect(page.headers.get("x-page")).toBe("yes");
  expect(page.headers.get("cache-control")).toBeNull();
  expect((await fetch(shell.url + "/")).headers.get("x-page")).toBeNull();
  await shell.stop();
});
