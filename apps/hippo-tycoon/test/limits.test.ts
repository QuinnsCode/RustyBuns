import { expect, test } from "bun:test";
import { RoomMintGate, TokenBucket, originAllowed } from "../src/engine/limits.ts";

test("token bucket: a burst, then the refill rate", () => {
  const b = new TokenBucket(10, 5, 0);
  expect(Array.from({ length: 6 }, () => b.take(0))).toEqual([true, true, true, true, true, false]);
  expect(b.take(50)).toBe(false);                 // half a token
  expect(b.take(100)).toBe(true);
  expect(b.take(10_000)).toBe(true);              // a long rest saves only the burst
  expect(Array.from({ length: 5 }, () => b.take(10_000)).filter(Boolean).length).toBe(4);
});

test("room mint gate: distinct rooms per key per window; rejoining is free", () => {
  const g = new RoomMintGate(3, 60_000, 2);
  expect(["A1", "A2", "A3"].map((r) => g.allow("ip1", r, 0))).toEqual([true, true, true]);
  expect(g.allow("ip1", "A4", 1000)).toBe(false);
  expect(g.allow("ip1", "A2", 1000)).toBe(true);  // a reconnect to a room it already has
  expect(g.allow("ip2", "A4", 1000)).toBe(true);  // another client
  expect(g.allow("ip1", "A4", 60_000)).toBe(true); // the window rolled past A1 and A3
  const small = new RoomMintGate(1, 60_000, 1);     // memory is capped: the least recent key is forgotten
  expect([small.allow("x", "R1", 0), small.allow("x", "R2", 0)]).toEqual([true, false]);
  small.allow("y", "R1", 0);
  expect(small.allow("x", "R2", 0)).toBe(true);
});

test("origin: same origin, localhost and LAN pass; another site does not; no Origin is not a browser", () => {
  const url = new URL("https://hippo-tycoon.example.workers.dev/ws?room=ABCD");
  expect(originAllowed(null, url)).toBe(true);
  expect(originAllowed("https://hippo-tycoon.example.workers.dev", url)).toBe(true);
  for (const o of ["http://localhost:5173", "http://127.0.0.1:8787", "http://[::1]:3000", "http://192.168.1.20:4000", "http://10.0.0.5", "http://172.20.1.1:80", "http://box.local:4000", "http://app.localhost"])
    expect(originAllowed(o, url)).toBe(true);
  for (const o of ["https://evil.example", "http://hippo-tycoon.example.workers.dev.evil.example", "null", "http://172.32.0.1", "http://8.8.8.8", "not a url"])
    expect(originAllowed(o, url)).toBe(false);
});
