import { describe, expect, test } from "bun:test";
import { CLIFF, SCALE, ZONES, zoneById, type Zone } from "../src/zones/zone.ts";
import { MOVE, canSee, clearLine, step, type Body } from "../src/hunt/sim.ts";
import { HUNT, Hunt, circleAt, dropOk, parseMsg } from "../src/hunt/game.ts";
import { fits, radioGrid, toKm } from "../src/clues.ts";
import { cellAt } from "../src/grid.ts";
import { Room, TICK_MS } from "../src/room.ts";

const walk = (z: Zone, b: Body, secs: number, run = false, role: "camper" | "ranger" = "camper") => {
  for (let i = 0; i < secs * 60; i++) step(z, b, role, { fwd: 1, right: 0, run, crouch: false }, 1 / 60);
};

/** A flat, open spot: gentle slope and nothing solid nearby. */
function openSpot(z: Zone, clear = 8): [number, number] {
  for (let r = 0; r < z.R * 0.8; r += 3) for (let a = 0; a < 6.28; a += 0.3) {
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (z.slope(x, y) < 0.08 && z.near(x, y, clear + 4).every((p) => Math.hypot(p.x - x, p.y - y) > clear + p.r) && z.reachable(x, y)) return [x, y];
  }
  throw new Error("no open spot");
}

describe.each(ZONES.map((d) => [d.id] as const))("%s", (id) => {
  const z = zoneById(id);

  test("real terrain, shrunk", () => {
    let hi = 0;
    for (const h of z.h) hi = Math.max(hi, h);
    expect(z.R).toBeCloseTo(z.data.realRadius / SCALE, 6);
    // Every zone has real relief: at least 50 m of real climb.
    expect(hi * SCALE).toBeGreaterThan(50);
  });

  test("the cabin sits on walkable ground, with drops possible round it", () => {
    expect(z.reachable(z.station.x, z.station.y)).toBe(true);
    let ok = 0;
    for (let k = 0; k < 200; k++) { const a = k * 2.4, d = Math.sqrt(k / 200) * z.R; if (dropOk(z, Math.cos(a) * d, Math.sin(a) * d)) ok++; }
    expect(ok).toBeGreaterThan(50);
  });

  test("props: plenty of bushes to hide in, every one inside the zone", () => {
    const bushes = z.props.filter((p) => p.kind === "bush");
    expect(bushes.length).toBeGreaterThan(150);
    expect(z.props.every((p) => z.inside(p.x, p.y))).toBe(true);
  });
});

describe("moving", () => {
  const z = zoneById("el-capitan");

  test("walking and running speeds; rangers outrun campers", () => {
    const [x, y] = openSpot(z, 3);
    const a: Body = { x, y, yaw: 0, stamina: 1, crouch: false, run: false };
    const b: Body = { ...a };
    walk(z, a, 1, true, "camper");
    walk(z, b, 1, true, "ranger");
    expect(Math.hypot(a.x - x, a.y - y)).toBeGreaterThan(MOVE.camper.run * 0.6);
    expect(Math.hypot(b.x - x, b.y - y)).toBeGreaterThan(Math.hypot(a.x - x, a.y - y));
  });

  test("running empties stamina, then you walk", () => {
    const [x, y] = openSpot(z, 3);
    const b: Body = { x, y, yaw: 0, stamina: 1, crouch: false, run: false };
    walk(z, b, MOVE.stamina.camper + 1, true);
    expect(b.stamina).toBeLessThan(0.05);
    expect(b.run).toBe(false);
  });

  test("nobody walks up El Capitan", () => {
    // Find a sample with a cliff above it, and walk straight at it.
    const n = z.n;
    let found: [number, number, number] | null = null;
    for (let i = 0; i < z.h.length && !found; i++) {
      const c = i % n, r = Math.floor(i / n);
      if (c + 1 >= n) continue;
      const x = -z.R + c * z.step, y = -z.R + r * z.step;
      const rise = z.h[i + 1] - z.h[i];
      if (z.inside(x, y, 10) && rise / z.step > CLIFF * 1.5) found = [x, y, rise];
    }
    expect(found).not.toBeNull();
    const [x, y, rise] = found!;
    // Face east, straight at the wall.
    const b: Body = { x, y, yaw: Math.PI / 2, stamina: 1, crouch: false, run: false };
    const h0 = z.height(x, y);
    walk(z, b, 3);
    expect(z.height(b.x, b.y) - h0).toBeLessThan(rise * 0.6);
  });

  test("you can't walk through a tree trunk", () => {
    const tree = z.props.find((p) => p.kind === "pine" && z.slope(p.x, p.y) < 0.3)!;
    const b: Body = { x: tree.x, y: tree.y - 3, yaw: 0, stamina: 1, crouch: false, run: false };
    for (let i = 0; i < 120; i++) {
      step(z, b, "camper", { fwd: 1, right: 0, run: false, crouch: false }, 1 / 60);
      expect(Math.hypot(b.x - tree.x, b.y - tree.y)).toBeGreaterThanOrEqual(tree.r);
    }
  });
});

describe("seeing", () => {
  const z = zoneById("mariposa-grove");
  const bush = z.props.find((p) => p.kind === "bush" && z.slope(p.x, p.y) < 0.2)!;

  test("crouched in a bush, you're invisible a few metres off; a flashlight close up finds you", () => {
    const hidden = { x: bush.x, y: bush.y, crouch: true };
    const facing = { x: bush.x + 6, y: bush.y, yaw: -Math.PI / 2, crouch: false, role: "ranger" as const, light: false };
    expect(canSee(z, "day", facing, hidden)).toBe(false);
    expect(canSee(z, "night", facing, hidden)).toBe(false);
    // The beam on the bush from 6 m reveals you (if nothing's in the way)...
    const lit = canSee(z, "night", { ...facing, light: true }, hidden);
    const clear = clearLine(z, facing.x, facing.y, z.height(facing.x, facing.y) + 1.6, bush.x, bush.y, z.height(bush.x, bush.y) + 0.6);
    expect(lit).toBe(clear);
    // ...but not from 15 m.
    expect(canSee(z, "night", { ...facing, x: bush.x + 15, light: true }, hidden)).toBe(false);
  });

  test("standing in the open in daylight, you're seen; at night only in the flashlight", () => {
    // Somewhere with a clear 12 m sight line, out of any bush, so only the light decides.
    const m = zoneById("el-capitan");
    let spot: [number, number] | null = null;
    for (let r = 0; r < m.R * 0.8 && !spot; r += 2) for (let a = 0; a < 6.28 && !spot; a += 0.2) {
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (m.bushAt(x, y) || !m.inside(x + 12, y, 1)) continue;
      if (clearLine(m, x + 12, y, m.height(x + 12, y) + 1.6, x, y, m.height(x, y) + 1.1)) spot = [x, y];
    }
    const [x, y] = spot!;
    const target = { x, y, crouch: false };
    const ranger = { x: x + 12, y, yaw: -Math.PI / 2, crouch: false, role: "ranger" as const, light: true }; // facing west, at the target
    expect(canSee(m, "day", { ...ranger, yaw: Math.PI / 2 }, target)).toBe(true);
    expect(canSee(m, "night", ranger, target)).toBe(true);
    expect(canSee(m, "night", { ...ranger, light: false }, target)).toBe(false);
    expect(canSee(m, "night", { ...ranger, yaw: Math.PI / 2 }, target)).toBe(false); // looking the other way
  });

  test("a giant sequoia blocks the view", () => {
    const s = z.props.find((p) => p.kind === "sequoia" && z.slope(p.x, p.y) < 0.3)!;
    const h = z.height(s.x, s.y);
    expect(clearLine(z, s.x - s.r - 3, s.y, h + 1.6, s.x + s.r + 3, s.y, h + 1.1)).toBe(false);
  });
});

/**
 * A two-player hunt on one zone. The first ranger is random, so the players
 * are renamed to match: "r" is this round's ranger, "c" the camper.
 */
function hunt(zone = "el-capitan", tod: "day" | "night" = "night") {
  const g = new Hunt(3);
  let now = 1_000_000;
  g.join("a", "A", now, { host: true });
  g.join("b", "B", now);
  g.handle("a", { t: "settings", zone, tod }, now);
  g.handle("a", { t: "start" }, now);
  const rid = g.round!.rangers[0], cid = rid === "a" ? "b" : "a";
  const id = (x: string) => (x === "r" ? rid : x === "c" ? cid : x);
  const real = g.handle.bind(g);
  // Tests speak in "r" and "c".
  g.handle = (who: string, m: any, t: number) => real(id(who), m, t);
  const actors = g.round!.actors;
  const get = actors.get.bind(actors);
  (actors as any).get = (k: string) => get(id(k));
  const view = g.view.bind(g);
  g.view = (who: string, t: number) => {
    const v = view(id(who), t);
    const back = (x: string) => (x === rid ? "r" : x === cid ? "c" : x);
    if (v.round) {
      v.round.others = v.round.others.map((o) => ({ ...o, id: back(o.id) }));
      v.round.cues = v.round.cues.map((q) => ({ ...q, by: back(q.by) }));
    }
    return v;
  };
  const tick = (ms: number) => { for (let t = 0; t < ms; t += TICK_MS) { now += TICK_MS; g.tick(now); } };
  return { g, tick, now: () => now, z: zoneById(zone), rid, cid };
}

describe("the hunt", () => {
  test("drop, hide, hunt: the camper lands where they chose, the ranger leaves the cabin", () => {
    const { g, tick, now, z } = hunt();
    expect(g.phase).toBe("drop");
    expect(g.round!.rangers).toHaveLength(1);
    const [x, y] = openSpot(z, 3);
    g.handle("c", { t: "drop", x, y }, now());
    g.handle("r", { t: "drop", x, y }, now()); // rangers don't drop
    expect(g.round!.actors.get("r")!.drop).toBeNull();
    tick(HUNT.dropSecs * 1000);
    expect(g.phase).toBe("hide");
    expect(g.round!.actors.get("c")!.x).toBeCloseTo(x, 6);
    // Rangers can't move while counting.
    const r0 = { ...g.round!.actors.get("r")! };
    g.handle("r", { t: "pos", x: r0.x + 1, y: r0.y, yaw: 0, pitch: 0, crouch: false, run: false, light: true }, now());
    expect(g.round!.actors.get("r")!.x).toBe(r0.x);
    tick(HUNT.hideSecs * 1000);
    expect(g.phase).toBe("hunt");
    expect(g.round!.circle).not.toBeNull();
  });

  test("a drop at the cabin or off the zone is refused", () => {
    const { g, now, z } = hunt();
    g.handle("c", { t: "drop", x: z.station.x, y: z.station.y }, now());
    g.handle("c", { t: "drop", x: z.R * 2, y: 0 }, now());
    expect(g.round!.actors.get("c")!.drop).toBeNull();
  });

  test("a ranger never receives a hidden camper's position", () => {
    const { g, tick, now, z } = hunt("mariposa-grove", "night");
    const bush = z.props.find((p) => p.kind === "bush" && dropOk(z, p.x, p.y) && Math.hypot(p.x - z.station.x, p.y - z.station.y) > 80)!;
    g.handle("c", { t: "drop", x: bush.x, y: bush.y }, now());
    tick((HUNT.dropSecs + HUNT.hideSecs) * 1000);
    const c = g.round!.actors.get("c")!;
    g.handle("c", { t: "pos", x: c.x, y: c.y, yaw: 0, pitch: 0, crouch: true, run: false, light: false }, now());
    expect(g.view("r", now()).round!.others.find((o) => o.id === "c")).toBeUndefined();
    // ...while the camper can see the ranger coming.
    const r = g.round!.actors.get("r")!;
    if (Math.hypot(r.x - c.x, r.y - c.y) < HUNT.rangerVisible) expect(g.view("c", now()).round!.others.find((o) => o.id === "r")).toBeDefined();
  });

  test("outside the closing circle, a camper is seen from anywhere", () => {
    const { g, tick, now } = hunt("el-capitan", "night");
    tick((HUNT.dropSecs + HUNT.hideSecs) * 1000);
    const r = g.round!;
    tick(HUNT.shrinkTo * 1000);
    const k = circleAt(r.circle!, now());
    // Put the camper just outside the circle, far from the ranger.
    const c = r.actors.get("c")!;
    const ang = Math.atan2(c.y - k.y, c.x - k.x);
    c.x = k.x + Math.cos(ang) * (k.r + 5); c.y = k.y + Math.sin(ang) * (k.r + 5);
    expect(g.view("r", now()).round!.others.some((o) => o.id === "c")).toBe(true);
  });

  test("a ranger catches a camper by reaching them, and scores for it", () => {
    const { g, tick, now, rid, cid } = hunt();
    tick((HUNT.dropSecs + HUNT.hideSecs) * 1000);
    const c = g.round!.actors.get("c")!, r = g.round!.actors.get("r")!;
    // Walk the ranger over in legal steps.
    for (let i = 0; i < 2000 && Math.hypot(r.x - c.x, r.y - c.y) > 1; i++) {
      const d = Math.hypot(c.x - r.x, c.y - r.y), s = Math.min(d, 0.3);
      tick(TICK_MS);
      g.handle("r", { t: "pos", x: r.x + ((c.x - r.x) / d) * s, y: r.y + ((c.y - r.y) / d) * s, yaw: 0, pitch: 0, crouch: false, run: true, light: true }, now());
      if (c.caughtAt) break;
    }
    expect(c.caughtAt).not.toBeNull();
    tick(1000);
    expect(g.phase).toBe("results");
    expect(g.round!.results!.find((x) => x.id === rid)!.points).toBe(HUNT.catchPoints);
    expect(g.players.find((p) => p.id === cid)!.score).toBeGreaterThan(0);
  });

  test("teleporting is refused: a move is clamped to what running allows", () => {
    const { g, tick, now } = hunt();
    tick((HUNT.dropSecs + HUNT.hideSecs) * 1000);
    const c = g.round!.actors.get("c")!;
    g.handle("c", { t: "pos", x: c.x, y: c.y, yaw: 0, pitch: 0, crouch: false, run: false, light: false }, now());
    const x0 = c.x, y0 = c.y;
    tick(100);
    g.handle("c", { t: "pos", x: x0 + 100, y: y0, yaw: 0, pitch: 0, crouch: false, run: true, light: false }, now());
    // 0.1 s of running at most, plus the slack for jitter (and a push out of a tree).
    expect(Math.hypot(c.x - x0, c.y - y0)).toBeLessThan(MOVE.camper.run * 1.4 * 0.1 + 0.6 + 1.5);
  });

  test("calling out makes nearby campers rustle, and only rangers hear it", () => {
    const { g, tick, now, cid } = hunt();
    tick((HUNT.dropSecs + HUNT.hideSecs) * 1000);
    const r = g.round!.actors.get("r")!, c = g.round!.actors.get("c")!;
    c.x = r.x + 10; c.y = r.y; // close by
    g.handle("r", { t: "call" }, now());
    g.handle("r", { t: "call" }, now()); // cooling down
    tick(1500);
    const cues = g.round!.cues;
    expect(cues.filter((q) => q.kind === "call")).toHaveLength(1);
    expect(cues.some((q) => q.kind === "rustle" && q.by === cid)).toBe(true);
    expect(g.view("r", now()).round!.cues.some((q) => q.kind === "rustle")).toBe(true);
    expect(g.view("c", now()).round!.cues.some((q) => q.kind === "rustle" && q.by !== "c")).toBe(false);
  });

  test("radio answers fit where the camper is, and campers only hear their own", () => {
    const { g, tick, now, z } = hunt();
    tick((HUNT.dropSecs + HUNT.hideSecs) * 1000);
    g.handle("r", { t: "ask", ask: { kind: "compass", axis: "ns" } }, now());
    const log = g.round!.asks[0];
    expect(log.answers).toHaveLength(1);
    const c = g.round!.actors.get("c")!, grid = radioGrid(z);
    expect(fits(grid, log.answers[0].clue, cellAt(grid, toKm(c.x), toKm(c.y)))).toBe(true);
    g.handle("c", { t: "ask", ask: { kind: "compass", axis: "ew" } }, now()); // campers can't ask
    expect(g.round!.asks).toHaveLength(1);
  });

  test("a camper who lasts the whole hunt camps out successfully", () => {
    const { g, tick, cid } = hunt();
    tick((HUNT.dropSecs + HUNT.hideSecs + HUNT.huntSecs) * 1000 + 200);
    expect(g.phase).toBe("results");
    expect(g.round!.results!.find((x) => x.id === cid)!.points).toBe(HUNT.huntSecs + HUNT.survivalBonus);
  });
});

describe("Bigfoot", () => {
  test("hides in the final circle, and is only seen up close", () => {
    const { g, tick, now, z } = hunt("el-capitan", "day");
    tick((HUNT.dropSecs + HUNT.hideSecs) * 1000);
    const r = g.round!, f = r.bigfoot!, c = r.circle!;
    expect(Math.hypot(f.x - c.x1, f.y - c.y1)).toBeLessThanOrEqual(c.r1 * HUNT.bigfootSpread + 1e-6);
    expect(z.inside(f.x, f.y)).toBe(true);
    const a = r.actors.get("c")!;
    a.x = f.x + 40; a.y = f.y;
    expect(g.view("c", now()).round!.bigfoot).toBeNull();
  });

  test("a camper who finds him ends the round: every camper still out camps out", () => {
    const { g, tick, rid, cid } = hunt();
    tick((HUNT.dropSecs + HUNT.hideSecs) * 1000);
    tick(20_000);
    const r = g.round!, f = r.bigfoot!, a = r.actors.get("c")!;
    a.x = f.x + 0.5; a.y = f.y;
    tick(TICK_MS);
    expect(g.phase).toBe("results");
    expect(r.foundBy).toBe(cid);
    const mine = r.results!.find((x) => x.id === cid)!;
    expect(mine.bigfoot).toBe(true);
    expect(mine.points).toBe(20 + HUNT.survivalBonus + HUNT.bigfootPoints);
    expect(r.results!.find((x) => x.id === rid)!.points).toBe(0);
  });

  test("a ranger who finds him first scores, and the campers don't camp out", () => {
    const { g, tick, rid, cid } = hunt();
    tick((HUNT.dropSecs + HUNT.hideSecs) * 1000);
    tick(30_000);
    const r = g.round!, f = r.bigfoot!, a = r.actors.get("r")!;
    a.x = f.x; a.y = f.y + 0.5;
    tick(TICK_MS);
    expect(g.phase).toBe("results");
    expect(r.results!.find((x) => x.id === rid)!.points).toBe(HUNT.bigfootPoints);
    expect(r.results!.find((x) => x.id === cid)!.points).toBe(30);
  });

  test("everyone hears him howl, roughly where he is", () => {
    const { g, tick, now } = hunt();
    tick((HUNT.dropSecs + HUNT.hideSecs) * 1000);
    tick(HUNT.shrinkFrom * 1000 + HUNT.howlEverySecs * 1000 + 100);
    const f = g.round!.bigfoot!;
    const howl = g.view("c", now()).round!.cues.find((q) => q.kind === "howl");
    expect(howl).toBeDefined();
    expect(g.view("r", now()).round!.cues.some((q) => q.kind === "howl")).toBe(true);
    expect(Math.hypot(howl!.x - f.x, howl!.y - f.y)).toBeLessThan(HUNT.howlJitter * 2.5 + 1e-6);
  });
});

test("bots play a whole match in every zone", () => {
  for (const z of ZONES) {
    const room = new Room(11);
    const g = room.game;
    let now = 1_000_000;
    g.join("h", "Host", now, { host: true });
    g.handle("h", { t: "settings", zone: z.id }, now);
    for (let i = 0; i < 3; i++) g.handle("h", { t: "bot", level: "normal" }, now);
    g.leave("h", now);
    g.hostId = g.players[0].id;
    g.handle(g.hostId, { t: "start" }, now);
    while (g.phase !== "over" && now < 1_000_000 + 3_600_000) { now += TICK_MS; room.tick(now); }
    expect(g.phase).toBe("over");
  }
}, 120_000);

test("parseMsg rejects junk from the wire", () => {
  expect(parseMsg(null)).toBeNull();
  expect(parseMsg({ t: "pos", x: 1, y: "2", yaw: 0, pitch: 0 })).toBeNull();
  expect(parseMsg({ t: "pos", x: 1, y: NaN, yaw: 0, pitch: 0 })).toBeNull();
  expect(parseMsg({ t: "ask", ask: { kind: "radar" } })).toBeNull();
  expect(parseMsg({ t: "look", look: { shirt: 99, pants: 0, skin: 0, hat: "cap" } })).toBeNull();
  expect(parseMsg({ t: "look", look: { shirt: 1, pants: 0, skin: 0, hat: "crown" } })).toBeNull();
  expect(parseMsg({ t: "drop", x: 1, y: 2 })).toEqual({ t: "drop", x: 1, y: 2 });
});
