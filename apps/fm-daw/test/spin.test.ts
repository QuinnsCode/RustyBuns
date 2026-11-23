// Who may spin, through the real World: a host makes a lineup of two, the first plays, a third person's deck commands
// go nowhere, the second cues up on the free deck in the last minutes and has the decks when the slot turns over; then
// open decks, where one person is refused, the first to play is on, the next asks and gets the decks when they step down.
import { afterEach, expect, test, setSystemTime } from "bun:test";
import { heard, setup, useWorld, type Sock } from "./world-kit.ts";
import { chain, decodeSpinServer, type Spin } from "../src/spin.ts";

useWorld();
afterEach(() => setSystemTime());

const T0 = Date.UTC(2026, 10, 22, 21, 0);
const MIN = 60_000;
const say = (side: 0 | 1, name: string | null, playing = true) =>
  ({ t: "deck", side, name, len: 300, grid: null, key: null, wave: "", cue: 0, playing, pos: 1, rate: 1, at: T0 });

test("a lineup of two turns over, a third person can't touch the decks, and open decks keep a refused person off", async () => {
  setSystemTime(T0);
  const { world, join } = await setup({}, "dusty-amber-owl");
  const said = (ws: Sock, m: object) => world.webSocketMessage(ws, JSON.stringify(m));
  const socks: Sock[] = [], ids: string[] = [];
  for (const k of ["a", "b", "c", "d"]) {
    const ws = (await join({}, k === "a" ? "a".repeat(32) : "")).ws;       // the first brings the maker's key: the host
    said(ws, { t: "hello", key: k.repeat(48), name: k });
    ids.push((await heard(ws, "chat")).you);
    socks.push(ws);
  }
  const [host, amy, bo, cy] = socks as [Sock, Sock, Sock, Sock];
  const [, amyId, boId, cyId] = ids as [string, string, string, string];
  const settle = () => new Promise((r) => setTimeout(r, 10));
  const spin = (): Spin => decodeSpinServer(host.sent.findLast((m) => m.t === "spin"))!.spin;
  /** Whether `ws`'s deck command reached the host. */
  const lands = async (ws: Sock, e: object) => {
    const n = host.sent.length;
    said(ws, { t: "live", e });
    await settle();
    return host.sent.slice(n).some((m) => m.t === "live" && m.e.t === (e as { t: string }).t);
  };
  await settle();

  // the host makes a lineup: Amy 21:00 for 30 minutes, then Bo
  said(host, { t: "spin", op: { o: "mode", mode: "lineup" } });
  said(host, { t: "spin", op: { o: "lineup", slots: chain([{ who: amyId, min: 30 }, { who: boId, min: 30 }], T0) } });
  said(cy, { t: "spin", op: { o: "lineup", slots: [] } });                // only the host edits it
  await settle();
  expect(spin()).toMatchObject({ mode: "lineup", lineup: [{ who: amyId, at: T0 }, { who: boId, at: T0 + 30 * MIN }] });
  expect(cy.sent.findLast((m) => m.t === "spin").spin.lineup).toHaveLength(2);   // everyone sees it

  // Amy plays deck A; Cy's deck and his press on Amy's deck go nowhere; Bo's slot hasn't started
  expect(await lands(amy, say(0, "Opening track"))).toBe(true);
  expect(await lands(cy, say(1, "Cy's track"))).toBe(false);
  expect(await lands(cy, { t: "press", to: 2, side: 0, press: "play" })).toBe(false);
  expect(await lands(bo, say(1, "Bo's first"))).toBe(false);

  // in Amy's last minutes Bo cues up on the free deck B, but can't load over Amy's playing deck A or press it
  setSystemTime(T0 + 27 * MIN);
  expect(await lands(bo, say(1, "Bo's first", false))).toBe(true);
  expect(await lands(bo, say(0, "Bo's second"))).toBe(false);
  expect(await lands(bo, { t: "press", to: 2, side: 0, press: "play" })).toBe(false);

  // the slot turns over: Bo plays and presses; Amy's last track plays out, but a new one of hers goes nowhere
  setSystemTime(T0 + 31 * MIN);
  expect(await lands(bo, say(1, "Bo's first"))).toBe(true);
  expect(await lands(bo, { t: "press", to: 2, side: 0, press: "play" })).toBe(true);
  expect(await lands(amy, say(0, "Opening track", false))).toBe(true);
  expect(await lands(amy, say(0, "Encore"))).toBe(false);
  expect(await lands(amy, say(0, null))).toBe(true);

  // the host takes Bo off at once: his slot ends now, his page is told to stop, and his deck isn't his to play out
  said(host, { t: "spin", op: { o: "off" } });
  await settle();
  expect(spin().lineup.find((s) => s.who === boId)!.min).toBe(1);
  expect(bo.sent.findLast((m) => m.t === "spin").off).toBe(boId);
  expect(await lands(bo, say(1, "Bo's first"))).toBe(false);

  // open decks, Cy refused: he can't play or ask; Amy steps up by playing, Bo asks and is on when she steps down
  said(host, { t: "spin", op: { o: "mode", mode: "open" } });
  said(host, { t: "spin", op: { o: "refuse", who: cyId, on: true } });
  await settle();
  expect(await lands(cy, say(0, "Cy's track"))).toBe(false);
  said(cy, { t: "spin", op: { o: "ask" } });
  expect(await lands(amy, say(0, "Open set"))).toBe(true);
  expect(spin().on).toBe(amyId);
  expect(await lands(bo, say(1, "Bo's track"))).toBe(false);
  said(bo, { t: "spin", op: { o: "ask" } });
  await settle();
  expect(spin().queue).toEqual([boId]);
  said(amy, { t: "spin", op: { o: "down" } });
  await settle();
  expect(spin()).toMatchObject({ on: boId, queue: [], refused: [cyId] });
  expect(await lands(bo, say(1, "Bo's track"))).toBe(true);
  expect(await lands(amy, say(0, "Open set", false))).toBe(true);           // hers plays out or stops
  expect(await lands(amy, say(0, "Another set"))).toBe(false);              // a new one waits for her turn
});
