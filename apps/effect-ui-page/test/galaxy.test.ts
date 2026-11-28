// Agent Galaxy through the running app: the dev server (scripts/dev.ts, the same galaxy and saved-world logic the
// Durable Objects run) and two rooms open in headless Chrome over CDP (scripts/chrome.ts), each in its own browser,
// signed in as its own person (a stand-in eqosys, eqosys-kit.ts) with a world its AI made, each walking as its own
// character through window.agentGalaxy. One journey, in order: two people claim two plots (and keep them), one walks
// off an edge onto the plot next door, each sees the other walk, an empty plot shows as empty, and a room that saved
// its world runs it for a neighbour who steps onto its plot. Plus the doors a page from another site may not use.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { type Cdp, freePort, launchChrome, load, openTab, waitFor } from "../../../scripts/chrome.ts";
import { cellOf, keptFree, spiral } from "../src/galaxy.ts";
import { fakeEqosys, signIn } from "./eqosys-kit.ts";

setDefaultTimeout(120_000); // Bun bundles the page cold, then two tabs walk it

test("the spiral: cell n to (x, y) and back, every third cell kept free for invites", () => {
  expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => spiral(n))).toEqual([
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: -1, y: 1 },
    { x: -1, y: 0 }, { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 2, y: -1 },
  ]);
  for (let n = 0; n < 400; n++) { const { x, y } = spiral(n); expect(cellOf(x, y)).toBe(n); }
  expect([1, 2, 3, 4, 5, 6].map(keptFree)).toEqual([false, false, true, false, false, true]);
});

interface Galaxy {
  in: boolean; error: string | null; me: { x: number; y: number; id: string } | null;
  plot: { x: number; y: number } | null; pos: { x: number; z: number } | null;
  plots: { x: number; y: number; id: string | null; empty: boolean; city: boolean; mine: boolean }[];
  players: { id: string; x: number; y: number; px: number; pz: number }[];
  live: { kind: string; id: string | null; files: { path: string; bytes: number }[] } | null;
  shows: Record<string, string>;
  look: { paint: number; head: string; eyes: string; top: string; feet: string } | null; building: boolean;
}

let chrome: Awaited<ReturnType<typeof launchChrome>>;
let server: ReturnType<typeof Bun.spawn>;
let base = "";
const eqosys = await fakeEqosys();
beforeAll(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = Bun.spawn(["bun", "scripts/dev.ts", "--port", String(port)], { cwd: join(import.meta.dir, ".."), env: { ...process.env, EQOSYS_URL: eqosys.url }, stdout: "ignore", stderr: "inherit" });
  chrome = await launchChrome();
  for (let i = 0; i < 300; i++) { if (await fetch(base).then((r) => r.ok, () => false)) break; await Bun.sleep(100); }
});
afterAll(() => { chrome?.stop(); server?.kill(); eqosys.stop(); });

const roomName = (tag: string) => `${tag}${Math.random().toString(36).slice(2, 12).padEnd(10, "0")}`.slice(0, 16);

/** A room in its own browser, signed in as `who`, its world made: the AI's write loaded clean and was saved. */
async function open(cdp: Cdp, room: string, who: string) {
  const tab = await openTab(cdp, { w: 1024, h: 720 }, false, true);
  await load(cdp, tab, `${base}/r/${room}`, 0);
  const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
  await waitFor(tab, "the galaxy handle", "!!window.agentGalaxy");
  eqosys.as({ id: `u_${who}`, email: `${who}@example.com`, name: who });
  await signIn(tab, eqosys.url);
  await page(`__commands.run("page_write_file", { path: "index.html", text: "<!doctype html><canvas></canvas>" })`);
  await waitFor(tab, "the world made", `!document.querySelector("[data-galaxy-lock]")`, 15_000);
  const until = (what: string, expr: string) => waitFor(tab, what, expr, 15_000, "agentGalaxy.state()", 50);
  return {
    room, tab, page, until,
    enter: () => page<Galaxy>("agentGalaxy.enter()"),
    leave: () => page<Galaxy>("agentGalaxy.leave()"),
    walk: (dx: number, dz: number) => page<Galaxy>(`agentGalaxy.walk(${dx}, ${dz})`),
    state: () => page<Galaxy>("agentGalaxy.state()"),
    errors: () => tab.noise.filter((n) => !n.startsWith("HTTP ")),
  };
}

describe("two rooms in Agent Galaxy", () => {
  let a: Awaited<ReturnType<typeof open>>, b: Awaited<ReturnType<typeof open>>;
  let meA: NonNullable<Galaxy["me"]>, meB: NonNullable<Galaxy["me"]>;

  test("each gets its own plot, and pressing again gives the same one back", async () => {
    [a, b] = [await open(chrome.cdp, roomName("a"), "ada"), await open(chrome.cdp, roomName("b"), "bob")];
    const first = await a.enter();
    expect(first).toMatchObject({ in: true, error: null, pos: { x: 0.5, z: 0.5 }, live: { kind: "mine" } });
    meA = first.me!;
    expect(await a.leave()).toMatchObject({ in: false });
    expect((await a.enter()).me).toEqual(meA);
    meB = (await b.enter()).me!;
    expect(meB.id).not.toBe(meA.id);
    expect([meB.x, meB.y]).not.toEqual([meA.x, meA.y]);
    // Two plots that touch, as the first two claims of the spiral do: (1, 0) and (1, 1).
    expect(Math.abs(meA.x - meB.x) <= 1 && Math.abs(meA.y - meB.y) <= 1).toBe(true);
  });

  test("an empty plot is in view and marked empty; the city is not", async () => {
    const plots = (await a.state()).plots;
    expect(plots.some((p) => p.empty && p.id === null)).toBe(true);
    expect(plots.find((p) => p.x === 0 && p.y === 0)).toMatchObject({ city: true, empty: false });
    expect(plots.find((p) => p.x === meA.x && p.y === meA.y)).toMatchObject({ mine: true, empty: false });
  });

  test("each sees the other's character, and sees it move", async () => {
    await a.until("B on A's screen", `agentGalaxy.state().players.some((p) => p.id === ${JSON.stringify(meB.id)})`);
    await b.until("A on B's screen", `agentGalaxy.state().players.some((p) => p.id === ${JSON.stringify(meA.id)})`);
    await b.walk(0.2, 0);
    await a.until("B moved", `agentGalaxy.state().players.some((p) => p.id === ${JSON.stringify(meB.id)} && Math.abs(p.px - 0.7) < 0.01)`);
  });

  test("a robot is built with picture buttons, seen by a neighbour, and kept for next time", async () => {
    // Neither has built one, so the builder came up by itself once the cloud lifted.
    await a.until("A's builder", "agentGalaxy.state().building");
    const press = (...names: string[]) => a.page(`${JSON.stringify(names)}.forEach((n) => document.querySelector('.robot-shop button[aria-label="' + n + '"]').click())`);
    await press("Green paint", "Dome head", "One big eye", "Propeller", "Hover");
    const built = { paint: 3, head: "dome", eyes: "one", top: "propeller", feet: "hover" };
    await b.until("A's robot on B's screen", `agentGalaxy.state().players.some((p) => p.id === ${JSON.stringify(meA.id)} && p.look.paint === 3 && p.look.feet === "hover")`);
    await press("Done");
    expect(await a.state()).toMatchObject({ building: false, look: built });
    await a.leave();
    expect(await a.enter()).toMatchObject({ look: built });
    await a.until("the cloud gone again", "(await new Promise((r) => setTimeout(r, 3000)), true)");
    expect((await a.state()).building).toBe(false);
    // The button brings it back.
    await a.page(`document.querySelector(".galaxy-robot").click()`);
    expect((await a.state()).building).toBe(true);
    await press("Done");
  });

  test("walking east off your plot lands you on the west edge of the plot next door", async () => {
    const s = await a.walk(0.6, 0);
    expect(s.plot).toEqual({ x: meA.x + 1, y: meA.y });
    expect(s.pos!.x).toBeCloseTo(0.1, 5);
    expect(s.pos!.z).toBeCloseTo(0.5, 5);
    expect(s.live!.kind).not.toBe("mine");
    // Back again: your own world runs live once more.
    expect((await a.walk(-0.6, 0)).live).toMatchObject({ kind: "mine", id: meA.id });
  });

  test("a room's saved world runs live for a neighbour who steps onto its plot", async () => {
    await a.page(`__commands.run("page_write_file", { path: "a.js", text: "// room A's own file" })`);
    for (let i = 0; i < 100; i++) {
      const saved = await fetch(`${base}/api/r/${a.room}/world`).then((r) => (r.ok ? r.json() : null));
      if (saved?.files?.["a.js"]) break;
      await Bun.sleep(100);
    }
    // B walks from its plot onto A's: north if A is north of it, and so on.
    const s0 = await b.state();
    const s = await b.walk((meA.x - s0.plot!.x) * 0.9, (meA.y - s0.plot!.y) * 0.9);
    expect(s.plot).toEqual({ x: meA.x, y: meA.y });
    expect(s.live).toMatchObject({ kind: "neighbour", id: meA.id });
    expect(s.live!.files.map((f) => f.path)).toContain("a.js");
    expect([...a.errors(), ...b.errors()]).toEqual([]);
  });

  test("a world built with the kit stands in 3D, for its owner and for a neighbour's next visit", async () => {
    await a.page(`__commands.run("page_write_file", { path: "a.js", text: 'import { ground, trees } from "@world/kit"; ground({ type: "hills" }); trees(20);' })`);
    await a.page(`__commands.run("page_write_file", { path: "index.html", text: '<!doctype html><script type="module" src="a.js"></script>' })`);
    for (let i = 0; i < 100; i++) {
      const saved = await fetch(`${base}/api/r/${a.room}/world`).then((r) => (r.ok ? r.json() : null));
      if (saved?.files?.["index.html"]?.includes("a.js")) break;
      await Bun.sleep(100);
    }
    const plot = `agentGalaxy.state().shows["${meA.x},${meA.y}"] === "land"`;
    await waitFor(a.tab, "A's own land as shapes", plot, 45_000, "agentGalaxy.state()");
    await b.leave();
    await b.enter();
    await waitFor(b.tab, "A's land from B's plot", plot, 45_000, "agentGalaxy.state()");
  });
});

test("a page from another site can't claim a plot, save a room's world or open a player's socket", async () => {
  const evil = { origin: "https://elsewhere.example", "content-type": "application/json" };
  const claim = await fetch(`${base}/api/galaxy/claim`, { method: "POST", headers: evil, body: JSON.stringify({ room: "evilroom0001" }) });
  expect(claim.status).toBe(403);
  const save = await fetch(`${base}/api/r/evilroom0001/world`, { method: "PUT", headers: evil, body: JSON.stringify({ files: { "index.html": "<p>hi" } }) });
  expect(save.status).toBe(403);
  expect((await fetch(`${base}/api/r/evilroom0001/world`)).status).toBe(404);
  const dress = await fetch(`${base}/api/galaxy/robot`, { method: "PUT", headers: evil, body: JSON.stringify({ look: { paint: 0, head: "box", eyes: "two", top: "ears", feet: "legs" } }) });
  expect(dress.status).toBe(403);
  const socket = await fetch(`${base}/api/galaxy/socket?room=evilroom0001`, { headers: { ...evil, upgrade: "websocket", connection: "upgrade" } });
  expect(socket.status).toBe(403);
});
