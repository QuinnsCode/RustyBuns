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

test("serve: a keep-alive socket on the old listener is told to close after a rebind (#975)", async () => {
  const shell = serve({});
  let n = 0;
  shell.mount({ async fetch(req) {
    if (new URL(req.url).pathname === "/rebind") shell.rebind({ hostname: ++n % 2 ? "0.0.0.0" : "127.0.0.1" });
    return new Response("ok");
  } }, {});
  const post = (p: string) => `POST ${p} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 0\r\n\r\n`;
  // A keep-alive client sends its next request the moment a response lands. The old
  // listener closes the socket under it, so the rebind response must say Connection: close.
  const around = () => new Promise<string>(async (res) => {
    let buf = "";
    await Bun.connect({ hostname: "127.0.0.1", port: shell.port, socket: {
      open(s) { s.write(post("/x") + post("/rebind")); },   // two requests on one socket around the rebind
      data(s, d) { buf += d; if (buf.split("\r\n\r\nok").length === 3) s.write(post("/x")); },
      close() { res(buf); },
      error(_s, e) { res(String(e)); },
    } });
  });
  for (let i = 0; i < 10; i++) {
    const [before, after] = (await around()).split(/(?=HTTP\/1\.1 )/);
    expect(before).not.toMatch(/^connection: close/im);   // still the live listener: keep-alive as usual
    expect(after).toMatch(/^connection: close/im);
  }
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

test("serve: through an HTTPS tunnel that keeps the Host, our own https Origin passes", async () => {
  const shell = serve({ token: "t0k" });
  shell.mount({ async fetch() { return new Response("ok"); } }, {});
  const cookie = (await fetch(shell.url + "/x?token=t0k", { redirect: "manual" })).headers.get("set-cookie")!;
  const post = (host: string, origin: string) => fetch(shell.url + "/__rb/action", { method: "POST", headers: { cookie, host, origin }, body: "{}" });
  expect((await post("mac.tail.ts.net", "https://mac.tail.ts.net")).status).toBe(200);
  expect((await post("mac.tail.ts.net", "https://evil.example")).status).toBe(403);
  await shell.stop();
});

test("serve: the host's page mints a pairing code that signs a phone in once", async () => {
  const shell = serve({ token: "t0k" });
  shell.mount({ async fetch() { return new Response("in"); } }, {});
  const cookie = (await fetch(shell.url + "/x?token=t0k", { redirect: "manual" })).headers.get("set-cookie")!;
  const pair = (init: RequestInit) => fetch(shell.url + "/__rb/pair", init);
  expect((await pair({ method: "POST", headers: { origin: shell.url } })).status).toBe(403);             // no cookie
  expect((await pair({ method: "POST", headers: { cookie } })).status).toBe(403);                        // no Origin: not the page
  expect((await pair({ method: "GET", headers: { cookie, origin: shell.url } })).status).toBe(403);
  expect((await pair({ method: "POST", headers: { cookie, origin: "http://127.0.0.1:1" } })).status).toBe(403);
  const r = await pair({ method: "POST", headers: { cookie, origin: shell.url } });
  const { code, ttlMs } = await r.json() as { code: string; ttlMs: number };
  expect(ttlMs).toBe(5 * 60_000);
  // The phone, through the tunnel: a foreign Host, no cookie yet.
  const phone = await fetch(shell.url + "/?rb_launch=" + code, { redirect: "manual", headers: { host: "mac.tail.ts.net" } });
  expect(phone.status).toBe(302);
  expect(phone.headers.get("set-cookie")).toContain("=t0k;");
  expect((await fetch(shell.url + "/?rb_launch=" + code, { redirect: "manual" })).status).toBe(403);   // once
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

test("serve: _redirects rules apply before assets, first match wins", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dir = mkdtempSync("/tmp/rb-assets-");
  mkdirSync(join(dir, "docs"));
  writeFileSync(join(dir, "docs", "index.html"), "<p>docs</p>");
  writeFileSync(join(dir, "old.html"), "<p>old</p>");
  writeFileSync(join(dir, "app.html"), "<p>app</p>");
  mkdirSync(join(dir, "app"));
  writeFileSync(join(dir, "app", "main.js"), "js");
  writeFileSync(join(dir, "_redirects"), [
    "# moved",
    "/old.html /new 301",
    "/blog/:year/:slug /posts/:slug?y=:year",
    "/guide/* /docs/:splat 308",
    "/app/* /app.html 200",
    "/out https://example.com/x#top",
    "/blog/* /never",
    "/bad /x 404",
    "https://example.com/* /y",
  ].join("\n"));
  const shell = serve({ assets: dir });
  shell.mount({ async fetch() { return new Response("worker", { status: 404 }); } }, {});
  const get = (p: string) => fetch(shell.url + p, { redirect: "manual" });
  let r = await get("/old.html");
  expect([r.status, r.headers.get("location")]).toEqual([301, "/new"]);
  r = await get("/blog/2024/hello");
  expect([r.status, r.headers.get("location")]).toEqual([302, "/posts/hello?y=2024"]);
  r = await get("/guide/a/b?q=1");
  expect([r.status, r.headers.get("location")]).toEqual([308, "/docs/a/b?q=1"]);
  r = await get("/out?q=1");
  expect(r.headers.get("location")).toBe("https://example.com/x?q=1#top");
  r = await get("/app/settings/me");
  expect([r.status, await r.text()]).toEqual([200, "<p>app</p>"]);
  // A 200 rewrite fills in only where no file is (live Pages serves /assets/main.js under `/* /index.html 200`).
  expect(await (await get("/app/main.js")).text()).toBe("js");
  expect((await get("/old.html")).status).toBe(301);
  expect((await get("/bad")).status).toBe(404);
  expect(await (await get("/bad")).text()).toBe("worker");
  expect(await (await get("/docs/")).text()).toBe("<p>docs</p>");
  expect(await (await get("/_redirects")).text()).toBe("worker");
  await shell.stop();
});

test("serve: runWorkerFirst sends matches to the Worker before the files, except what a ! pattern names", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dir = mkdtempSync("/tmp/rb-assets-");
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "file");
  writeFileSync(join(dir, "assets", "a.js"), "file");
  const shell = serve({ assets: dir, runWorkerFirst: ["/*", "!/assets/*"] });
  shell.mount({ async fetch() { return new Response("worker"); } }, {});
  const get = async (p: string) => (await fetch(shell.url + p)).text();
  expect([await get("/index.html"), await get("/api/x"), await get("/assets/a.js")]).toEqual(["worker", "worker", "file"]);
  await shell.stop();
});

test("serve: /page serves page.html when nothing sits at /page, as Cloudflare and GitHub Pages do", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dir = mkdtempSync("/tmp/rb-assets-");
  mkdirSync(join(dir, "apps"));
  writeFileSync(join(dir, "apps", "ops.html"), "<p>ops</p>");
  writeFileSync(join(dir, "data.json.html"), "<p>no</p>");
  const shell = serve({ assets: dir });
  const get = (p: string) => fetch(shell.url + p).then(async (r) => [r.status, r.status === 200 ? await r.text() : ""]);
  expect(await get("/apps/ops")).toEqual([200, "<p>ops</p>"]);
  expect(await get("/apps/ops.html")).toEqual([200, "<p>ops</p>"]);
  expect((await get("/apps/nope"))[0]).toBe(404);
  // a path with an extension is taken as asked
  expect((await get("/data.json"))[0]).toBe(404);
  shell.stop?.();
});

test("serve: a missing page gets the nearest 404.html with status 404, as Cloudflare's 404-page and GitHub Pages do", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dir = mkdtempSync("/tmp/rb-assets-");
  mkdirSync(join(dir, "docs", "deep"), { recursive: true });
  writeFileSync(join(dir, "404.html"), "<p>lost</p>");
  writeFileSync(join(dir, "docs", "404.html"), "<p>no such doc</p>");
  writeFileSync(join(dir, "_headers"), "/docs/*\n  X-Docs: yes\n");
  const shell = serve({ assets: dir });
  const get = async (p: string) => { const r = await fetch(shell.url + p); return [r.status, await r.text(), r.headers.get("content-type")?.split(";")[0]]; };
  expect(await get("/nope")).toEqual([404, "<p>lost</p>", "text/html"]);
  expect(await get("/a/b/c")).toEqual([404, "<p>lost</p>", "text/html"]);
  expect(await get("/docs/nope")).toEqual([404, "<p>no such doc</p>", "text/html"]);
  expect(await get("/docs/deep/er/nope")).toEqual([404, "<p>no such doc</p>", "text/html"]);
  expect((await fetch(shell.url + "/docs/nope")).headers.get("x-docs")).toBe("yes");
  // a handler that falls through asks the shell for the same page
  shell.mount({ fetch: (req) => new URL(req.url).pathname === "/api" ? new Response("api") : shell.notFound(new URL(req.url)) }, {});
  expect((await get("/api")).slice(0, 2)).toEqual([200, "api"]);
  expect(await get("/docs/gone")).toEqual([404, "<p>no such doc</p>", "text/html"]);
  await shell.stop();
  // no 404.html: plain text, as before
  const bare = serve({ assets: mkdtempSync("/tmp/rb-assets-") });
  expect(await fetch(bare.url + "/nope").then(async (r) => [r.status, await r.text()])).toEqual([404, "not found"]);
  await bare.stop();
});
