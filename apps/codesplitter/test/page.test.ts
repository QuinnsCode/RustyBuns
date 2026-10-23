import { describe, expect, test } from "bun:test";
import { local as boot } from "./app-kit.ts";
import { pagePath, withData } from "../src/page.ts";

describe("putting your page back", () => {
  test("default restores the starter and empties the rest; an hour back empties what is newer than that", async () => {
    const call = await boot({ GH_CLI: "off" });
    const send = (user: string | null, url: string, body?: unknown) =>
      call(user, url, { method: body === undefined ? "GET" : "POST", ...(body !== undefined && { body: JSON.stringify(body) }) });
    await send("ryan", "/api/login", { name: "ryan" });
    expect((await send("ryan", "/api/me/page/revert", { to: "default" })).status).toBe(404);
    expect((await send(null, "/api/me/page/revert", { to: "default" })).status).toBe(401);
    expect((await send("ryan", "/api/me/page/revert", { to: "never" })).status).toBe(400);
    await send("ryan", "/api/repos", { name: "page" });
    await send("ryan", "/api/repos/ryan/page/files", { path: "index.html", content: "<h1>mine</h1>" });
    await send("ryan", "/api/repos/ryan/page/files", { path: "extra.js", content: "1;" });

    const out = await (await send("ryan", "/api/me/page/revert", { to: "default" })).json() as any;
    expect(out.changed.sort()).toEqual(["extra.js", "index.html", "world.js"]);
    const html = await (await send(null, "/api/users/ryan/page/")).text();
    expect(html).toContain("world.js");
    expect(html).not.toContain("mine");
    expect(await (await send(null, "/api/users/ryan/page/world.js")).text()).toContain("THREE.WebGLRenderer");
    expect((await send(null, "/api/users/ryan/page/extra.js")).status).toBe(404);

    // Everything above happened within the hour, so an hour back is a page with nothing in it.
    const back = await (await send("ryan", "/api/me/page/revert", { to: "hour" })).json() as any;
    expect(back.unreachable).toEqual([]);
    expect((await send(null, "/api/users/ryan/page/world.js")).status).toBe(404);
  });
});

describe("your page", () => {
  test("serves the public page repo in a script sandbox, with only public data", async () => {
    const call = await boot({ GH_CLI: "off" });
    const send = (user: string | null, url: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
      call(user, url, { method, ...(body !== undefined && { body: JSON.stringify(body) }) });
    await send("ryan", "/api/login", { name: "ryan" });
    await send("ryan", "/api/repos", { name: "page" });
    await send("ryan", "/api/repos", { name: "vault", visibility: "private" });
    await send("ryan", "/api/repos/ryan/page/files", { path: "index.html", content: "<!doctype html><head></head><script src=\"world.js\"></script>" });
    await send("ryan", "/api/repos/ryan/page/files", { path: "world.js", content: "console.log(1)" });

    const res = await send(null, "/api/users/ryan/page/");
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toStartWith("sandbox allow-scripts");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain("allow-same-origin");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    const html = await res.text();
    expect(html).toContain('<script src="world.js">');
    const data = JSON.parse(/id="profile">([^<]*)</.exec(html)![1]!);
    expect(data.repos).toEqual(["page"]);   // the private repo is no one's business
    expect(html.indexOf("<!doctype")).toBe(0);

    const js = await send(null, "/api/users/ryan/page/world.js");
    expect(js.headers.get("content-type")).toStartWith("text/javascript");
    expect(await js.text()).toBe("console.log(1)");
    expect((await send(null, "/api/users/ryan/page/nope.js")).status).toBe(404);

    // The app's own origin never runs a page file as a script; the sandboxed frame (cross-site) still does.
    const as = (site: string, dest: string) => call(null, "/api/users/ryan/page/world.js", { headers: { "sec-fetch-site": site, "sec-fetch-dest": dest } });
    expect((await as("same-origin", "script")).status).toBe(403);
    expect((await as("same-origin", "worker")).status).toBe(403);
    expect((await as("cross-site", "script")).status).toBe(200);
    expect((await as("same-origin", "empty")).status).toBe(200);
    expect((await send(null, "/api/users/ryan/page/pic.png")).status).toBe(415);
    expect((await (await send(null, "/api/users/ryan")).json() as any).page).toBe(true);
  });

  test("falls back to the saved HTML, and says when there is no page", async () => {
    const call = await boot({ GH_CLI: "off" });
    const send = (user: string | null, url: string, body?: unknown, method = body === undefined ? "GET" : "PUT") =>
      call(user, url, { method, ...(body !== undefined && { body: JSON.stringify(body) }) });
    await call("mia", "/api/login", { method: "POST", body: JSON.stringify({ name: "mia" }) });
    expect((await send(null, "/api/users/mia/page/")).status).toBe(404);
    expect(((await (await send(null, "/api/users/mia")).json()) as any).page).toBe(false);
    await send("mia", "/api/me", { theme_html: "<h1>hi</h1>" });
    const res = await send(null, "/api/users/mia/page/");
    expect(await res.text()).toContain("<h1>hi</h1>");
    expect(res.headers.get("content-security-policy")).toStartWith("sandbox");
  });

  test("says so when a public page repo hides the saved HTML", async () => {
    const call = await boot({ GH_CLI: "off" });
    const put = async (body: unknown) => (await call("ned", "/api/me", { method: "PUT", body: JSON.stringify(body) })).json() as Promise<any>;
    await call("ned", "/api/login", { method: "POST", body: JSON.stringify({ name: "ned" }) });
    expect((await put({ theme_html: "<h1>a</h1>" })).warning).toBeUndefined();
    await call("ned", "/api/repos", { method: "POST", body: JSON.stringify({ name: "page" }) });
    await call("ned", "/api/repos/ned/page/files", { method: "POST", body: JSON.stringify({ path: "index.html", content: "<h1>repo</h1>" }) });
    expect((await put({ theme_html: "<h1>b</h1>" })).warning).toContain("public page repo");
    expect((await put({ bio: "hi" })).warning).toBeUndefined();
  });

  test("keeps paths inside the page and data from closing its block", () => {
    expect(pagePath([])).toBe("index.html");
    expect(pagePath(["a", "b.js"])).toBe("a/b.js");
    for (const bad of [["..", "x"], [".git", "config"], ["a", ""], ["a\\b"]]) expect(pagePath(bad)).toBeNull();
    expect(withData("<head></head>", { bio: "</script><b>" })).not.toContain("</script><b>");
  });
});

describe("page tools", () => {
  test("edit_my_page writes a file and the page version moves with it", async () => {
    const call = await boot({ GH_CLI: "off" });
    const send = (user: string | null, url: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
      call(user, url, { method, ...(body !== undefined && { body: JSON.stringify(body) }) });
    await send("ryan", "/api/login", { name: "ryan" });
    expect((await send("ryan", "/api/me/page", { path: "index.html", content: "x" }, "PUT")).status).toBe(404);
    await send("ryan", "/api/repos", { name: "page" });
    expect((await send(null, "/api/me/page", { path: "index.html", content: "x" }, "PUT")).status).toBe(401);
    expect((await send("ryan", "/api/me/page", { path: "../x.html", content: "x" }, "PUT")).status).toBe(400);
    expect((await send("ryan", "/api/me/page", { path: "a.exe", content: "x" }, "PUT")).status).toBe(400);
    await send("ryan", "/api/me/page", { path: "index.html", content: "<h1>one</h1>" }, "PUT");
    const v1 = ((await (await send(null, "/api/users/ryan/page-version")).json()) as any).version;
    expect(v1).toContain("index.html:");
    const same = await (await send("ryan", "/api/me/page", { path: "index.html", content: "<h1>one</h1>" }, "PUT")).json() as any;
    expect(same.changed).toBe(false);
    await send("ryan", "/api/me/page", { path: "index.html", content: "<h1>two</h1>" }, "PUT");
    expect(((await (await send(null, "/api/users/ryan/page-version")).json()) as any).version).not.toBe(v1);
    expect(await (await send(null, "/api/users/ryan/page/")).text()).toContain("two");
  });
});

describe("binary files of your page", () => {
  test("go to R2 and come back under the sandbox, only for the owner and only the allowed kinds", async () => {
    const store = new Map<string, Uint8Array>();
    const LEVEL_CHUNKS = {
      put: async (k: string, v: Uint8Array) => void store.set(k, v),
      get: async (k: string) => (store.has(k) ? { arrayBuffer: async () => store.get(k)!.buffer } : null),
      list: async ({ prefix }: { prefix: string }) => ({ objects: [...store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }), delete: async () => {},
    };
    const call = await boot({ GH_CLI: "off", LEVEL_CHUNKS } as any);
    const put = (user: string | null, name: string, bytes: Uint8Array) => call(user, `/api/me/page/assets/${name}`, { method: "PUT", body: bytes as BodyInit });
    await call("ryan", "/api/login", { method: "POST", body: JSON.stringify({ name: "ryan" }) });
    expect((await put("ryan", "cat.png", new Uint8Array([1]))).status).toBe(404); // no page repo yet
    await call("ryan", "/api/repos", { method: "POST", body: JSON.stringify({ name: "page" }) });
    expect((await put(null, "cat.png", new Uint8Array([1]))).status).toBe(401);
    expect((await put("ryan", "run.exe", new Uint8Array([1]))).status).toBe(400);
    expect((await put("ryan", "cat.png", new Uint8Array(5_000_001))).status).toBe(413);
    expect(await (await put("ryan", "cat.png", new Uint8Array([1, 2, 3]))).json()).toEqual({ path: "assets/cat.png", bytes: 3 });
    const got = await call(null, "/api/users/ryan/page/assets/cat.png");
    expect([got.status, got.headers.get("content-type"), got.headers.get("content-security-policy")]).toEqual([200, "image/png", expect.stringContaining("sandbox")]);
    expect([...new Uint8Array(await got.arrayBuffer())]).toEqual([1, 2, 3]);
    expect((await call(null, "/api/users/ryan/page/assets/dog.png")).status).toBe(404);
    expect((await call(null, "/api/users/bob/page/assets/cat.png")).status).toBe(404);
    expect((await put("ryan", "cat.png", new Uint8Array([4]))).status).toBe(200); // a rewrite is free
    for (let i = 1; i < 50; i++) expect((await put("ryan", `f${i}.png`, new Uint8Array([1]))).status).toBe(200);
    expect((await put("ryan", "one-too-many.png", new Uint8Array([1]))).status).toBe(413);
    expect((await put("ryan", "cat.png", new Uint8Array([5]))).status).toBe(200);
    const big = await call("ryan", "/api/me/page", { method: "PUT", body: JSON.stringify({ path: "index.html", content: "x".repeat(1_000_001) }) });
    expect(big.status).toBe(413);
  });
});
