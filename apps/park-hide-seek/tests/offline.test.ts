import { expect, test } from "bun:test";
import "../src/offline.ts";
import { TICK_MS } from "../src/room.ts";

type Phase = "lobby" | "drop" | "hide" | "hunt" | "results" | "over";
interface PhsRoom { create(seed: number, opts: object, now: number): string; handle(json: string, now: number): void; tick(now: number): string; zone(id: string): string | null }
const phs = (globalThis as unknown as { PhsRoom: PhsRoom }).PhsRoom;
const read = (json: string) => (JSON.parse(json) as { t: string; view: { phase: Phase; zone: string; players: { id: string }[]; round: { you: { role: string } | null; results: unknown[] | null } | null } }).view;

// What the iOS app does with the bundle: start a game against bots, press Start, and let the clock run.
test("a whole game against bots runs from the lobby to game over, with no network", () => {
  let now = 1_000_000;
  const first = read(phs.create(7, { name: "Ada", bots: 3, zone: "half-dome" }, now));
  expect(first.phase).toBe("lobby");
  expect(first.players).toHaveLength(4);

  phs.handle(JSON.stringify({ t: "start" }), now);
  const seen = new Set<Phase>();
  let results = 0;
  for (let i = 0; i < 60_000 && !seen.has("over"); i++) {
    now += TICK_MS;
    const v = read(phs.tick(now));
    if (!seen.has(v.phase) && v.phase === "results") results++;
    seen.add(v.phase);
    if (v.phase === "drop" && v.round?.you) phs.handle(JSON.stringify({ t: "drop", x: 0, y: 0 }), now);
  }
  expect([...seen]).toEqual(expect.arrayContaining(["drop", "hide", "hunt", "results", "over"]));
  expect(results).toBeGreaterThan(0);
});

test("the ground of a bundled zone is what the edge serves; an unknown zone is nothing", () => {
  const z = JSON.parse(phs.zone("half-dome")!);
  expect(z.id).toBe("half-dome");
  expect(z.heights.length).toBeGreaterThan(z.n * z.n);
  expect(phs.zone("nowhere")).toBeNull();
});

test("a message the app can't have meant is dropped", () => {
  phs.create(1, { bots: 0 }, 0);
  phs.handle("not json", 0);
  phs.handle(JSON.stringify({ t: "pos", x: "far" }), 0);
  expect(read(phs.tick(50)).phase).toBe("lobby");
});
