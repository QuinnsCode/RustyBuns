import { expect, test } from "bun:test";
import { Match } from "../src/engine/match.ts";
import { decodeClient, decodeServer, decodeSnapshot, encodeSnapshot, LAN_VERSION, MAX_CLIENT_MESSAGE, PROTO_VERSION } from "../src/engine/wire.ts";
import { COUNTDOWN_TICKS } from "../src/sim/rules.ts";

test("client messages are validated strictly", () => {
  expect(decodeClient(`{"t":"hello","v":${PROTO_VERSION}}`)).toEqual({ t: "hello", v: PROTO_VERSION });
  expect(decodeClient(`{"t":"in","m":-100,"g":1,"h":0}`)).toEqual({ t: "in", m: -100, g: 1, h: 0 });
  expect(decodeClient(`{"t":"in","m":101,"g":0,"h":0}`)).toBeNull();
  expect(decodeClient(`{"t":"in","m":0.5,"g":0,"h":0}`)).toBeNull();
  expect(decodeClient(`{"t":"in","m":0,"g":2,"h":0}`)).toBeNull();
  expect(decodeClient(`{"t":"cfg","secs":45}`)).toBeNull();
  expect(decodeClient(`{"t":"cfg","secs":90,"diff":"hard"}`)).toEqual({ t: "cfg", secs: 90, diff: "hard" });
  expect(decodeClient(`{"t":"cfg","diff":"godlike"}`)).toBeNull();
  expect(decodeClient(`{"t":"seat","n":4}`)).toBeNull();
  expect(decodeClient(`{"t":"nope"}`)).toBeNull();
  expect(decodeClient("[1,2]")).toBeNull();
  expect(decodeClient("x".repeat(MAX_CLIENT_MESSAGE + 1))).toBeNull();
  expect(decodeClient(42)).toBeNull();
});

test("server messages that are the wrong shape are dropped", () => {
  expect(decodeServer(`{"t":"snap","hp":1}`)).toBeNull();
  expect(decodeServer(`{"t":"room","ph":"nowhere","seats":[]}`)).toBeNull();
  expect(decodeServer("garbage")).toBeNull();
  expect(decodeServer(`{"t":"pong","n":3}`)).toEqual({ t: "pong", n: 3 });
});

test("a snapshot survives the wire to within its quantisation", () => {
  const m = new Match(3);
  m.join("a", "Ada"); m.start();
  for (let i = 0; i < COUNTDOWN_TICKS + 400; i++) { m.input(0, Math.sin(i / 9), i % 11 === 0, false); m.tick(); }
  const snap = m.snapshot();
  expect(snap.drops.length).toBeGreaterThan(0);
  const wire = JSON.stringify(encodeSnapshot(snap));
  const back = decodeSnapshot(decodeServer(wire) as never);
  expect(back.tick).toBe(snap.tick);
  expect(back.round).toBe(snap.round);
  expect(back.phase).toBe(snap.phase);
  expect(back.left).toBe(snap.left);
  expect(back.drops.map((d) => [d.id, d.kind])).toEqual(snap.drops.map((d) => [d.id, d.kind]));
  snap.drops.forEach((d, i) => { expect(Math.abs(back.drops[i]!.x - d.x)).toBeLessThanOrEqual(0.005 + 1e-9); expect(Math.abs(back.drops[i]!.y - d.y)).toBeLessThanOrEqual(0.005 + 1e-9); });
  snap.hippos.forEach((h, i) => {
    const b = back.hippos[i]!;
    expect(Math.abs(b.slide - h.slide)).toBeLessThanOrEqual(0.0005 + 1e-9);
    expect([b.gulp, b.cooldown, b.sputter, b.sore, b.flooded, b.dud, b.score, b.bellow]).toEqual([h.gulp, h.cooldown, h.sputter, h.sore, h.flooded, h.dud, h.score, h.bellow]);
  });
  expect(wire.length).toBeLessThan(4000);          // a busy pan is a few KB per frame, 15 times a second
});

test("the LAN version tracks the protocol", () => {
  expect(LAN_VERSION).toContain(String(PROTO_VERSION));
});
