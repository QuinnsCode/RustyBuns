import { describe, expect, test } from "bun:test";
import { QUICK, QuickMatch } from "../src/edge/match.ts";

const codes = () => { let n = 0; return () => `QROOM${++n}`; };

describe("quick play", () => {
  test("everyone in the same window gets the same room, starting at the same moment", () => {
    const q = new QuickMatch(codes());
    const a = q.pick("alice-0001", 1000);
    const b = q.pick("bob-00001", 4000);
    expect(b.room).toBe(a.room);
    expect(a.startsIn).toBe(QUICK.windowMs);
    expect(1000 + a.startsIn).toBe(4000 + b.startsIn);
    // Only the first one opens the room, so the World is told when to start just once.
    expect([a.opened, b.opened]).toEqual([true, false]);
  });

  test("too close to the start opens a fresh room", () => {
    const q = new QuickMatch(codes());
    const a = q.pick("alice-0001", 0);
    const late = q.pick("bob-00001", QUICK.windowMs - QUICK.minLeftMs + 1);
    expect(late.room).not.toBe(a.room);
    expect(late.startsIn).toBe(QUICK.windowMs);
  });

  test("a full room opens the next one, but asking again keeps your spot", () => {
    const q = new QuickMatch(codes());
    const first = q.pick("player-00", 0).room;
    for (let i = 1; i < QUICK.maxPeople; i++) expect(q.pick(`player-0${i}`, 10).room).toBe(first);
    expect(q.pick("player-00", 20).room).toBe(first);
    expect(q.pick("latecomer", 30).room).not.toBe(first);
  });
});
