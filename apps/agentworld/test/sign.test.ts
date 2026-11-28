// Signing for your land, through the running app (scripts/dev.ts, a stand-in eqosys): first the door over plain HTTP,
// then two people in headless Chrome, one with a mouse and one on a phone with a finger. Each signs before their first
// visit to the galaxy, one sees the other's sign standing, hides it, and it stays hidden on the next visit.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { freePort, launchChrome, load, openTab, waitFor } from "../../../scripts/chrome.ts";
import { fakeEqosys, type Person, scrawlOnPad, signIn } from "./eqosys-kit.ts";

setDefaultTimeout(120_000); // Bun bundles the page cold

const eqosys = await fakeEqosys();
let chrome: Awaited<ReturnType<typeof launchChrome>>;
let server: ReturnType<typeof Bun.spawn>;
let base = "";
beforeAll(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = Bun.spawn(["bun", "scripts/dev.ts", "--port", String(port)], { cwd: join(import.meta.dir, ".."), env: { ...process.env, EQOSYS_URL: eqosys.url }, stdout: "ignore", stderr: "inherit" });
  chrome = await launchChrome();
  for (let i = 0; i < 300; i++) { if (await fetch(base).then((r) => r.ok, () => false)) break; await Bun.sleep(100); }
});
afterAll(() => { chrome?.stop(); server?.kill(); eqosys.stop(); });

const roomName = (tag: string) => `${tag}${Math.random().toString(36).slice(2, 12).padEnd(10, "0")}`.slice(0, 16);
const line = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i % 600, y: 100 }));

test("the door takes only pen strokes, within the caps, from a signed-in person on this page, a few at a time", async () => {
  const token = await eqosys.token({ id: "u_dee", email: "dee@example.com", name: "Dee" });
  const sign = (body: unknown, headers: Record<string, string> = {}) => fetch(`${base}/api/galaxy/sign`, {
    method: "POST", body: JSON.stringify(body), headers: { origin: base, "content-type": "application/json", authorization: `Bearer ${token}`, ...headers },
  }).then((r) => r.status);
  expect(await sign({ strokes: [line(8)] }, { authorization: "" })).toBe(401);
  expect(await sign({ strokes: [line(8)] }, { origin: "https://elsewhere.example" })).toBe(403);
  expect(await sign({ image: "data:image/png;base64,AAAA" })).toBe(400);
  expect(await sign({ strokes: "my name" })).toBe(400);
  expect(await sign({ strokes: [[{ x: 9000, y: 0 }, ...line(8)]] })).toBe(400);
  expect(await sign({ strokes: [line(900), line(900)] })).toBe(400);
  expect(await sign({ strokes: [line(8)], padding: "x".repeat(50_000) })).toBe(413);
  // Someone else, with their own allowance: the first goes in, a loop of them is stopped.
  const eve = { authorization: `Bearer ${await eqosys.token({ id: "u_eve", email: "eve@example.com", name: "Eve" })}` };
  const tries: number[] = [];
  for (let i = 0; i < 8; i++) tries.push(await sign({ strokes: [line(8)] }, eve));
  expect([tries[0], tries.at(-1)]).toEqual([200, 429]);
});

interface State { in: boolean; me: { x: number; y: number; id: string } | null; plot: { x: number; y: number } | null; signing: boolean; signs: Record<string, { mine: boolean }> }

/** A person in their own browser, signed in, their world made. */
async function person(who: Person, room: string, phone: boolean) {
  const tab = await openTab(chrome.cdp, phone ? { w: 390, h: 844 } : { w: 1024, h: 720 }, phone, true);
  const visit = async () => { await load(chrome.cdp, tab, `${base}/r/${room}`, 0); await waitFor(tab, "the galaxy handle", "!!window.agentGalaxy"); };
  await visit();
  eqosys.as(who);
  await signIn(tab, eqosys.url);
  await tab.eval(`__commands.run("page_write_file", { path: "index.html", text: "<!doctype html><canvas></canvas>" })`);
  await waitFor(tab, "the world made", `!document.querySelector("[data-galaxy-lock]")`, 15_000);
  const enter = () => tab.eval<State>(`agentGalaxy.enter()`);
  const done = async () => {
    await tab.eval(`document.querySelector(".sign-done").click()`);
    await waitFor(tab, "signed and on your plot", `!agentGalaxy.state().signing && agentGalaxy.state().ready`, 20_000, "agentGalaxy.state()");
  };
  return { tab, visit, enter, done, state: () => tab.eval<State>(`agentGalaxy.state()`) };
}

test("each signs before their first visit; a neighbour's sign stands, can be hidden, and stays hidden", async () => {
  const ada = await person({ id: "u_ada", email: "ada@example.com", name: "Ada" }, roomName("a"), false);
  expect(await ada.enter()).toMatchObject({ signing: true, me: null });
  const off = `document.querySelector(".sign-done").disabled`;
  expect(await ada.tab.eval<boolean>(off)).toBe(true);
  await scrawlOnPad(ada.tab);
  expect(await ada.tab.eval<boolean>(off)).toBe(false);
  // Clear wipes it, and there is nothing to send again.
  await ada.tab.eval(`document.querySelector(".sign-clear").click()`);
  expect(await ada.tab.eval<boolean>(off)).toBe(true);
  await scrawlOnPad(ada.tab);
  await ada.done();
  const a = (await ada.state()).me!, adas = `${a.x},${a.y}`;
  await waitFor(ada.tab, "her own sign", `!!agentGalaxy.state().signs["${adas}"]`, 15_000, "agentGalaxy.state()");
  expect((await ada.state()).signs[adas]).toEqual({ mine: true });
  expect(await ada.tab.eval<number>(`document.querySelectorAll(".sign-hide").length`)).toBe(0);

  const bob = await person({ id: "u_bob", email: "bob@example.com", name: "Bob" }, roomName("b"), true);
  expect(await bob.enter()).toMatchObject({ signing: true });
  await scrawlOnPad(bob.tab, true);
  await bob.done();
  const b = (await bob.state()).me!;
  // Over to Ada's land: her sign is there, with a button to hide it.
  await bob.tab.eval(`agentGalaxy.walk(${a.x - b.x}, ${a.y - b.y})`);
  const button = `document.querySelector('.sign-hide[data-plot="${adas}"]')`;
  await waitFor(bob.tab, "Ada's sign and its button", `${button}?.hidden === false`, 20_000, "agentGalaxy.state()");
  await bob.tab.eval(`${button}.click()`);
  expect((await bob.state()).signs[adas]).toBeUndefined();
  // Next visit: still hidden, and no second signing.
  await bob.visit();
  expect(await bob.enter()).toMatchObject({ signing: false, in: true });
  await bob.tab.eval(`agentGalaxy.walk(${a.x - b.x}, ${a.y - b.y})`);
  await Bun.sleep(1000);
  expect((await bob.state()).signs[adas]).toBeUndefined();
  // Hidden for Bob only: Ada still has it, and can sign again.
  expect((await ada.state()).signs[adas]).toEqual({ mine: true });
  await ada.tab.eval(`document.querySelector(".sign-again").click()`);
  await scrawlOnPad(ada.tab);
  await ada.done();
  expect((await ada.state()).signs[adas]).toEqual({ mine: true });
  expect([...ada.tab.noise, ...bob.tab.noise].filter((n) => !n.startsWith("HTTP "))).toEqual([]);
});
