// "Your account is your world", through the running app: the dev server (scripts/dev.ts) checking tokens against a
// stand-in eqosys (eqosys-kit.ts), first over plain HTTP, then pages in headless Chrome, each browser its own context.
// One world per person and it follows them; a plot needs a signed-in person whose world is made; the Galaxy tile is
// locked until then, and a ready-made world doesn't open it.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { freePort, launchChrome, load, openTab, waitFor } from "../../../scripts/chrome.ts";
import { enterSigned, fakeEqosys, type Person, signIn } from "./eqosys-kit.ts";

setDefaultTimeout(120_000); // Bun bundles the page cold

const ada: Person = { id: "u_ada", email: "ada@example.com", name: "Ada" };
const bob: Person = { id: "u_bob", email: "bob@example.com", name: "Bob" };
const eqosys = await fakeEqosys();
let chrome: Awaited<ReturnType<typeof launchChrome>>;
let server: ReturnType<typeof Bun.spawn>;
let base = "";
beforeAll(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = Bun.spawn(["bun", "scripts/dev.ts", "--port", String(port)], { cwd: join(import.meta.dir, ".."), env: { ...process.env, EQOSYS_URL: eqosys.url }, stdout: "ignore", stderr: "inherit" });
  for (let i = 0; i < 300; i++) { if (await fetch(base).then((r) => r.ok, () => false)) break; await Bun.sleep(100); }
});
afterAll(() => { chrome?.stop(); server?.kill(); eqosys.stop(); });

const roomName = (tag: string) => `${tag}${Math.random().toString(36).slice(2, 12).padEnd(10, "0")}`.slice(0, 16);
const post = (path: string, body: unknown, token?: string) => fetch(`${base}${path}`, {
  method: "POST", body: JSON.stringify(body),
  headers: { origin: base, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
});
const worldOf = async (token: string, room: string) => (await (await post("/api/me/world", { room }, token)).json()).room;

describe("over HTTP", () => {
  test("one world per person: the first room you send, from any browser after", async () => {
    const [a, b] = [roomName("a"), roomName("b")];
    const [adas, bobs] = [await eqosys.token(ada), await eqosys.token(bob)];
    expect(await worldOf(adas, a)).toBe(a);
    expect(await worldOf(adas, b)).toBe(a);
    expect(await worldOf(bobs, b)).toBe(b);
  });

  test("a plot: 401 signed out, 409 before the world is made, then a plot, the same one again, and nothing in it names you", async () => {
    const room = roomName("c"), carol = { id: "u_carol", email: "carol@example.com", name: "Carol" };
    const token = await eqosys.token(carol);
    expect((await post("/api/galaxy/claim", { room })).status).toBe(401);
    expect(await worldOf(token, room)).toBe(room);
    const early = await post("/api/galaxy/claim", { room }, token);
    expect([early.status, (await early.json()).error]).toEqual([409, "Make your world first"]);
    // Another room than your world is refused.
    expect((await post("/api/galaxy/claim", { room: roomName("d") }, token)).status).toBe(403);
    // What the page sends once the AI's write loaded clean.
    expect((await post(`/api/r/${room}/made`, { files: { "index.html": "<canvas></canvas>" } })).status).toBe(200);
    // Made, but not signed for yet (sign.test.ts has the rest of signing).
    const unsigned = await post("/api/galaxy/claim", { room }, token);
    expect([unsigned.status, (await unsigned.json()).error]).toEqual([409, "Sign for your land first"]);
    expect((await post("/api/galaxy/sign", { strokes: [Array.from({ length: 8 }, (_, i) => ({ x: i * 40, y: 100 }))] }, token)).status).toBe(200);
    const plot = await (await post("/api/galaxy/claim", { room }, token)).json();
    expect(Object.keys(plot).sort()).toEqual(["id", "x", "y"]);
    expect(await (await post("/api/galaxy/claim", { room }, token)).json()).toEqual(plot);
    const listed = JSON.stringify(await (await fetch(`${base}/api/galaxy/plots?x=${plot.x}&y=${plot.y}&r=1`)).json());
    for (const secret of [room, carol.id, carol.email, token]) expect(listed).not.toContain(secret);
  });

  test("a token for another app, an expired one and a garbled one are refused", async () => {
    const good = await eqosys.token(ada);
    for (const token of [
      await eqosys.token(ada, { app: "qcrm" }),
      await eqosys.token(ada, { at: Date.now() - 11 * 60_000 }),
      `${good.slice(0, -6)}AAAAAA`,
      "not-a-token",
    ]) {
      expect((await post("/api/me/world", { room: roomName("e") }, token)).status).toBe(401);
      expect((await post("/api/galaxy/claim", { room: roomName("e") }, token)).status).toBe(401);
    }
  });
});

describe("in the page", () => {
  beforeAll(async () => { chrome = await launchChrome(); });

  const open = async (room: string) => {
    const tab = await openTab(chrome.cdp, { w: 1024, h: 720 }, false, true);
    await load(chrome.cdp, tab, `${base}/r/${room}`, 0);
    await waitFor(tab, "the galaxy handle", "!!window.agentGalaxy");
    const locked = () => tab.eval<string | undefined>(`(async () => (await agentGalaxy.enter()).locked)()`);
    return { tab, locked };
  };
  const roomA = roomName("pa");

  test("locked on a fresh room; signed in, still locked with a ready-made world; open after your AI's clean write", async () => {
    const { tab, locked } = await open(roomA);
    expect(await locked()).toBe("Sign in and make your world first");
    eqosys.as({ ...ada, id: "u_ada_page" });
    expect(await signIn(tab, eqosys.url)).toBe(roomA);
    expect(await locked()).toBe("Make your world first");
    expect(await tab.eval<string | null>(`document.querySelector("[data-galaxy-lock]")?.textContent ?? null`)).toBe("Make your world first");
    // A person's click on a ready-made world loads it clean, and the galaxy stays shut.
    await tab.eval(`document.querySelector("[data-try]").click()`);
    await Bun.sleep(1500);
    expect(await locked()).toBe("Make your world first");
    // The AI writes; the frame loads it clean; the page saves it as made.
    await tab.eval(`__commands.run("page_write_file", { path: "index.html", text: "<!doctype html><canvas></canvas><p>Ada's world</p>" })`);
    await waitFor(tab, "the lock to go", `!document.querySelector("[data-galaxy-lock]")`, 15_000);
    const s = await enterSigned<{ in: boolean; me: { id: string } | null; locked?: string }>(tab);
    expect([s.in, s.locked, typeof s.me?.id]).toEqual([true, undefined, "string"]);
  });

  test("signed in on a second browser, you land in the same world, its files from the server", async () => {
    const { tab } = await open(roomName("pb"));
    eqosys.as({ ...ada, id: "u_ada_page" });
    expect(await signIn(tab, eqosys.url)).toBe(roomA);
    expect(await tab.eval<string>(`__commands.run("page_read_file", { path: "index.html" }).then((r) => r.text)`)).toContain("Ada's world");
    expect((await tab.eval<{ in: boolean }>(`agentGalaxy.enter()`)).in).toBe(true);
    expect(tab.noise.filter((n) => !n.startsWith("HTTP "))).toEqual([]);
  });
});
