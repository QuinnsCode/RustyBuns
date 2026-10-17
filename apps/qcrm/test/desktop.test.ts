import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(120_000);

// The desktop app end to end: build the binary, start it on an empty HOME, sign up, make a contact, run a
// script, quit, start it again on the same data and find the account and the rows still there.
const build = async () => {
  const p = Bun.spawn(["bun", "run", "desktop:build"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
  if (await p.exited) throw new Error(await new Response(p.stderr).text());
};

const start = async (home: string, bin: string) => {
  const proc = Bun.spawn([bin], { env: { ...process.env, HOME: home, RB_NO_BROWSER: "1", BETTER_AUTH_SECRET: "" }, stdout: "ignore", stderr: "ignore" });
  const file = join(home, ".qcrm", "desktop.json");
  for (let i = 0; i < 100; i++) {
    try { const j = JSON.parse(readFileSync(file, "utf8")); if (j.pid === proc.pid) return { proc, ...(j as { url: string; token: string }) }; } catch {}
    await Bun.sleep(100);
  }
  proc.kill();
  throw new Error("desktop app never wrote desktop.json");
};

test("desktop: sign up, a contact, a script, restart, same account", async () => {
  await build();
  const os = process.platform === "win32" ? "windows" : process.platform;
  const bin = join(import.meta.dir, "..", "dist", `qcrm-${os}-${process.arch === "arm64" ? "arm64" : "x64"}`);
  const home = mkdtempSync(join(tmpdir(), "qcrm-desktop-"));
  let app = await start(home, bin);
  try {
    let jar = new Map<string, string>();
    const call = async (path: string, init: RequestInit = {}) => {
      const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
      const res = await fetch(app.url + path, { ...init, redirect: "manual", headers: { cookie, origin: app.url, "content-type": "application/json" } });
      for (const c of res.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv!.indexOf("="); jar.set(kv!.slice(0, i), kv!.slice(i + 1)); }
      return res;
    };
    const post = (path: string, body: unknown) => call(path, { method: "POST", body: JSON.stringify(body) });

    // No token, no entry; the token logs the browser in.
    expect((await fetch(app.url + "/")).status).toBe(403);
    await call(`/?token=${app.token}`);
    // The Worker's configured URL is the production one: the desktop trusts its own loopback origin instead.
    expect((await post("/api/auth/sign-up/email", { email: "a@desk.test", password: "correct-horse-9", name: "A" })).status).toBe(200);
    const org = ((await (await call("/api/me")).json()) as any).orgs[0].id as string;
    await post(`/api/orgs/${org}/contacts`, { first_name: "Ada", email: "ada@x.co" });
    const script = (await (await post(`/api/orgs/${org}/scripts`, { name: "n", body: `const r = await qcrm.list("contacts"); return r.total;` })).json()) as any;
    const ran = (await (await post(`/api/orgs/${org}/scripts/${script.id}/run`, {})).json()) as any;
    expect([ran.status, ran.result]).toEqual(["ok", 1]);

    // Quit and start again: the launch token is new, the account and its org are not.
    app.proc.kill();
    await app.proc.exited;
    app = await start(home, bin);
    jar = new Map();
    await call(`/?token=${app.token}`);
    expect((await post("/api/auth/sign-in/email", { email: "a@desk.test", password: "correct-horse-9" })).status).toBe(200);
    expect(((await (await call("/api/me")).json()) as any).orgs[0].id).toBe(org);
  } finally {
    app.proc.kill();
    rmSync(home, { recursive: true, force: true });
  }
});
