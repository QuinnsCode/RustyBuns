import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(120_000);

// TanStack Start on the desktop, end to end: build the dev host, start it on an empty HOME, add a note
// through a server route, find it in the server-rendered page, quit, start again and find it still there.
const app = join(import.meta.dir, "..");
const token = "start-example-token";

const start = async (home: string) => {
  const proc = Bun.spawn(["bun", ".rustybuns/dev/desktop.js"], { cwd: app, env: { ...process.env, HOME: home, RB_NO_BROWSER: "1", RB_TOKEN: token }, stdout: "pipe", stderr: "ignore" });
  let seen = "";
  for await (const chunk of proc.stdout) {
    seen += new TextDecoder().decode(chunk);
    const url = seen.match(/serving (http:\/\/[\d.]+:\d+)/)?.[1];
    if (url) return { proc, url, cookie: `rb_token_${new URL(url).port}=${token}` };
  }
  throw new Error(`host exited before serving:\n${seen}`);
};

test("desktop: a note through a server route, the SSR page from D1 and KV, restart, still there", async () => {
  const build = Bun.spawn(["bun", "../../packages/cli/src/index.ts", "build", "desktop", "--dev"], { cwd: app, stdout: "pipe", stderr: "pipe" });
  if (await build.exited) throw new Error(await new Response(build.stderr).text());
  const home = mkdtempSync(join(tmpdir(), "start-example-"));
  let host = await start(home);
  try {
    const get = (path: string) => fetch(host.url + path, { headers: { cookie: host.cookie } });
    // The page as text: React marks where one text piece ends and the next starts.
    const page = async () => (await (await get("/")).text()).replaceAll("<!-- -->", "");
    expect((await fetch(host.url + "/")).status).toBe(403);

    const add = await fetch(host.url + "/api/notes", { method: "POST", headers: { cookie: host.cookie, "content-type": "application/json" }, body: JSON.stringify({ text: "buy oat milk" }) });
    expect(add.status).toBe(201);
    expect((await (await get("/api/notes")).json() as { text: string }[]).map((n) => n.text)).toEqual(["buy oat milk"]);

    // The loader's server function reads D1 and counts the visit in KV, rendered on the server.
    const first = await page();
    expect(first).toContain("buy oat milk");
    expect(first).toContain("Visit 1,");

    host.proc.kill();
    await host.proc.exited;
    host = await start(home);
    const again = await page();
    expect(again).toContain("buy oat milk");
    expect(again).toContain("Visit 2,");
  } finally {
    host.proc.kill();
    rmSync(home, { recursive: true, force: true });
  }
});
