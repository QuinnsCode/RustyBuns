import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";
import { heightOf, layout } from "../src/city.ts";

// End to end (in-process D1 and file DOs): fine alone, slow on a busy machine.
setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

/** ryan's public lab (a.ts by ryan, b.ts mostly by agent-claude) and private vault; ana follows ryan, bob doesn't. */
async function app() {
  const call = await boot({ GH_CLI: "off" });
  opened.push(call);
  const send = (user: string | null, url: string, body: unknown, method = "POST") => call(user, url, { method, body: JSON.stringify(body) });
  for (const u of ["ryan", "ana", "bob"]) await send(u, "/api/login", { name: u });
  await send("ryan", "/api/repos", { name: "lab", visibility: "public" });
  await send("ryan", "/api/repos", { name: "vault", visibility: "private" });
  await send("ryan", "/api/repos/ryan/lab/collaborators", { name: "agent-claude" });
  await send("ryan", "/api/repos/ryan/lab/files", { path: "a.ts", content: "one\ntwo\nthree" });
  await send("ryan", "/api/repos/ryan/lab/files", { path: "b.ts", content: "x" });
  await send("agent-claude", "/api/repos/ryan/lab/do/ops?path=b.ts", { ops: [{ kind: "insert", after: null, text: "y" }, { kind: "insert", after: null, text: "z" }] });
  await send("ryan", "/api/repos/ryan/vault/files", { path: "s.ts", content: "secret" });
  await send("ana", "/api/follows", { name: "ryan" });
  // The DOs write line events after the edits answer.
  for (const end = performance.now() + 5000; performance.now() < end;) {
    if (((await call.env.DB.prepare("SELECT COUNT(*) AS n FROM line_events WHERE repo = 'lab'").first()) as any).n >= 2) break;
    await Bun.sleep(10);
  }
  const city = async (who: string | null, name = "ryan") => { const r = await call(who, `/api/users/${name}/city`); return { status: r.status, body: (await r.json()) as any }; };
  return { call, send, city };
}

test("public repos are districts, files are buildings: height from lines, material from who wrote them, lit by recent lines", async () => {
  const { city } = await app();
  const { status, body } = await city(null);
  expect(status).toBe(200);
  expect(body.districts.map((d: any) => d.repo)).toEqual(["lab"]);
  const [a, b] = body.districts[0].buildings;
  expect(a).toMatchObject({ path: "a.ts", lines: 3, agent: 0, h: heightOf(3) });
  expect(b).toMatchObject({ path: "b.ts", lines: 3, agent: 0.67 });
  expect(a.glow).toBeGreaterThan(0.9);
  expect(body).toMatchObject({ files: 2, lines: 6, visit: false });
  // Everyone who just landed lines is in town; nothing from the private repo is.
  expect(body.present.map((p: any) => p.who).sort()).toEqual(["agent-claude", "ryan"]);
  expect(JSON.stringify(body)).not.toContain("vault");
  expect(JSON.stringify(body)).not.toContain("secret");
});

test("the postcard is a PNG; the owner can switch the public city off", async () => {
  const { call, send, city } = await app();
  const png = await call(null, "/api/users/ryan/city.png");
  expect(png.headers.get("content-type")).toBe("image/png");
  expect([...new Uint8Array(await png.arrayBuffer()).slice(1, 4)]).toEqual([80, 78, 71]);

  expect((await send("ryan", "/api/me/city", { public: false }, "PUT")).status).toBe(200);
  expect((await city("ana")).status).toBe(404);
  expect((await call(null, "/api/users/ryan/city.png")).status).toBe(404);
  // Its owner still sees it.
  expect((await city("ryan")).body).toMatchObject({ public: false });
  expect((await (await call("ryan", "/api/users/ryan")).json() as any).user.city_public).toBe(0);
  await send("ryan", "/api/me/city", { public: true }, "PUT");
  expect((await city("ana")).status).toBe(200);
  expect((await city("ana", "nobody")).status).toBe(404);
});

test("followers can walk the streets; others can only look", async () => {
  const { call, city } = await app();
  expect((await city("ana")).body.visit).toBe(true);
  expect((await call("bob", "/api/users/ryan/city/ws")).status).toBe(403);
  expect((await call(null, "/api/users/ryan/city/ws")).status).toBe(403);
  expect((await call("ana", "/api/users/ryan/city/ws")).status).toBe(426);
});

test("layout: districts don't overlap, and every building stands inside its own", () => {
  const b = (n: number) => Array.from({ length: n }, (_, i) => ({ path: `f${i}`, lines: 10, agent: 0, last: null, glow: 0 }));
  const ds = layout([{ repo: "big", buildings: b(10) }, { repo: "small", buildings: b(1) }, { repo: "mid", buildings: b(4) }]);
  for (const d of ds) for (const x of d.buildings) {
    expect(x.x - x.w / 2).toBeGreaterThanOrEqual(d.x);
    expect(x.x + x.w / 2).toBeLessThanOrEqual(d.x + d.size);
    expect(x.z - x.w / 2).toBeGreaterThanOrEqual(d.z);
    expect(x.z + x.w / 2).toBeLessThanOrEqual(d.z + d.size);
  }
  expect(ds[1]!.x).toBeGreaterThanOrEqual(ds[0]!.x + ds[0]!.size);
  expect(ds[2]!.z).toBeGreaterThanOrEqual(ds[0]!.z + ds[0]!.size);
});

test("files only in git stand too, counted once by blob; binaries and dotfiles don't", async () => {
  const { call, send, city } = await app();
  await send("ryan", "/api/repos", { name: "dug", visibility: "public" });
  const { push } = await import("../src/git.ts");
  const h = await call.artifacts.get("ryan--dug");
  const [info, token] = await Promise.all([h.info(), h.createToken("write", 300)]);
  await push(info.remote, token.plaintext, { changes: { "src/main.ts": "a\nb\nc\nd\n", "logo.png": "\u0000png", ".env": "X=1\n" }, message: "upstream", author: "upstream" });
  const dug = (await city(null)).body.districts.find((d: any) => d.repo === "dug");
  expect(dug.buildings.map((b: any) => [b.path, b.lines, b.glow])).toEqual([["src/main.ts", 4, 0]]);
  expect(((await call.env.DB.prepare("SELECT COUNT(*) AS n FROM blob_lines").first()) as any).n).toBe(2);
});
