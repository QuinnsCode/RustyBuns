import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";
import { pagePath, withData } from "../src/page.ts";

setDefaultTimeout(20_000);
const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

describe("putting your page back", () => {
  test("default restores the starter and empties the rest; an hour back empties what is newer than that", async () => {
    const call = await boot({ GH_CLI: "off" });
    opened.push(call);
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
    opened.push(call);
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
    expect((await send(null, "/api/users/ryan/page/pic.png")).status).toBe(415);
    expect((await (await send(null, "/api/users/ryan")).json() as any).page).toBe(true);
  });

  test("falls back to the saved HTML, and says when there is no page", async () => {
    const call = await boot({ GH_CLI: "off" });
    opened.push(call);
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

  test("keeps paths inside the page and data from closing its block", () => {
    expect(pagePath([])).toBe("index.html");
    expect(pagePath(["a", "b.js"])).toBe("a/b.js");
    for (const bad of [["..", "x"], [".git", "config"], ["a", ""], ["a\\b"]]) expect(pagePath(bad)).toBeNull();
    expect(withData("<head></head>", { bio: "</script><b>" })).not.toContain("</script><b>");
  });
});
