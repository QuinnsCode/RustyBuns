// The event world (#6535), as its people meet it: a performer opens an event's room and two guests walk in on its link,
// in headless Chrome, each in a browser of their own. Both guests see each other and the performer, both get the
// performer's set on the room's speakers, and who can do what holds: a guest talks and watches until the performer
// hands them something. The real worker and room Durable Object run in-process on shell-bun; the pages come from vite;
// eqosys is a stand-in that lets anyone into the event.
import { expect, setDefaultTimeout, test } from "bun:test";
import { durableObject, serve } from "@rustybuns/shell-bun";
import type { EventDoor } from "@rustybuns/util/events";
import { load, openTab, waitFor } from "../../../scripts/chrome.ts";
import { chrome, hasChrome, useBrowser, vite } from "./browser-kit.ts";
import worker from "../src/worker.ts";
import World from "../packages/desktop/world.ts";

setDefaultTimeout(240_000); // three jam rooms in software GL with their audio up
useBrowser("--disable-audio-output", "--autoplay-policy=no-user-gesture-required");

type May = { play: boolean; edit: boolean; mix: boolean; lights: boolean; speak: boolean };
type State = { net: string; others: unknown[]; grants: { may: May }; lights: { level: string } };
type Pa = { mine: string | null; live: { name: string; heard: boolean }[]; calls: { line: string; state: string }[] };

test.skipIf(!hasChrome)("an event's room: two guests see each other and the performer, hear the set, and do only what they're let", async () => {
  const eqosys = Bun.serve({ port: 0, fetch: () => Response.json({ access: "anyone", in: true } satisfies EventDoor) });
  const nothing = { idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response("", { status: 404 }) }) };
  const shell = serve<Parameters<typeof worker.fetch>[1]>({ headers: {} });
  const ASSETS = { fetch: (r: Request) => { const u = new URL(r.url); return fetch(`${vite.url.replace(/\/$/, "")}${u.pathname}${u.search}`, { headers: { accept: r.headers.get("accept") ?? "*/*" } }); } };
  shell.mount(worker, { ASSETS, WORLD: durableObject(World, { ROOM_SEATS: "16", EQOSYS_URL: `http://127.0.0.1:${eqosys.port}` }), LOBBY: nothing, PROFILE: nothing, LISTEN: nothing });
  const room = `${shell.url}/jam.html?room=event-gig&studio=desert-gathering&quality=low`;

  const walkIn = async (url: string) => {
    const tab = await openTab(chrome.cdp, { w: 1280, h: 720 }, false, true);
    await load(chrome.cdp, tab, url, 0);
    const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
    const until = (what: string, expr: string) => waitFor(tab, what, expr, 90_000, "window.qjam?.state().grants");
    await until("the room", `window.qjam?.state().net === "online"`);
    return { tab, page, until, state: () => page<State>("qjam.state()") };
  };
  // the maker's page is the first one in, and names the event; the guests' link doesn't
  const performer = await walkIn(`${room}&event=gig`);
  const guests = [await walkIn(room), await walkIn(room)];
  const everyone = [performer, ...guests];
  for (const p of everyone) await p.until("the other two in sight", "qjam.state().others.length === 2");
  for (const p of everyone) await p.page("(qjam.start(), 1)");
  for (const g of guests) {
    await g.until("a guest's grants", "qjam.state().grants.may.play === false");
    expect((await g.state()).grants.may).toMatchObject({ play: false, edit: false, mix: false, lights: false, speak: true });
  }

  // the performer plays a set to the room; each guest gets it over a call of their own
  await performer.page("qjam.pa(true)");
  for (const g of guests) {
    await g.until("the set on the room's speakers", `(await qjam.pa()).live.some((l) => l.name === "Test tone" && l.heard) && (await qjam.pa()).calls.some((c) => c.line === "pa-in" && c.state === "connected")`);
  }

  // a guest can't put their own sound on the PA, or touch the lights
  const [ada, bo] = guests;
  expect((await ada!.page<Pa>("qjam.pa(true)")).mine).toBeNull();
  await ada!.page(`qjam.lights({ level: "dark" })`);
  expect((await performer.state()).lights.level).toBe("full");

  // "just lights": the performer presses Lights beside one guest, who then dims the room for everyone
  const press = (word: string) => performer.page(`([...document.querySelector("#people .cans").children].find((b) => b.textContent === ${JSON.stringify(word)}).click(), 1)`);
  await press("Lights");
  await waitFor(performer.tab, "a guest given the lights", `Object.values(qjam.state().grants.others).some((m) => m.as === "Lights")`, 30_000);
  let lighting = ada!, other = bo!;
  if (!(await ada!.state()).grants.may.lights) { await bo!.until("the lights granted", "qjam.state().grants.may.lights"); lighting = bo!; other = ada!; }
  expect((await lighting.state()).grants.may).toMatchObject({ play: false, mix: false, lights: true });
  await lighting.page(`qjam.lights({ level: "dim" })`);
  for (const p of [performer, other]) await p.until("the room dimmed", `qjam.state().lights.level === "dim"`);

  // listen only: that same row's switch takes speaking away too
  await press("Listen only");
  await lighting.until("listen only", "!qjam.state().grants.may.speak && !qjam.state().grants.may.lights");

  for (const p of everyone) await p.tab.close();
  await shell.stop();
  eqosys.stop(true);
});
