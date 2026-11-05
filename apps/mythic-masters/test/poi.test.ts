import { describe, expect, test } from "bun:test";
import { Director, found } from "../src/director.ts";
import { hasTrail, loadJourney, newJourney, sections } from "../src/journey.ts";
import { REGIONS } from "../src/regions.ts";
import { arrive, findTape, lightFire, MIN_GAP, POIS, SQUARE, tapeOf, tapesFound, fireSpot, type Poi } from "../src/world/poi.ts";
import { bandAt, newTrek, TRAILS, trek, trailhead, WORLD } from "../src/world/trail.ts";
import { CELL, heightAt, ownerAt, spawn, type Walker } from "../src/world/world.ts";
import { GRID } from "../src/world/places.ts";
import { close, CLUES, DONE, HUNTS, huntsIn, nextClues, STEP, take, track, waiting } from "../src/world/hunts.ts";

const trailed = REGIONS.filter(hasTrail);

describe("places on the ground", () => {
  test.each(trailed.map((g) => [g.n, g.name] as const))("region %i (%s): 120 m apart, off the stones, on dry ground, one in every square of open ground", (n) => {
    const ps = POIS.get(n)!, stones = TRAILS.get(n)!.stones;
    expect(ps.length).toBeGreaterThanOrEqual(12);
    expect(new Set(ps.map((p) => p.id)).size).toBe(ps.length);
    for (const [i, p] of ps.entries()) {
      expect([p.id, ownerAt(p.x, p.z) === n && heightAt(WORLD, p.x, p.z) > 0.3 && bandAt(p.x, p.z) > 0]).toEqual([p.id, true]);
      expect(stones.every((s) => Math.hypot(s.x - p.x, s.z - p.z) > 20)).toBe(true);
      for (const q of ps.slice(i + 1)) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThanOrEqual(MIN_GAP);
    }
    let squares = 0;
    // Every 600 m square that is mostly open ground of this region holds a place.
    for (let r = 0; r * SQUARE < GRID.h * CELL; r++) for (let c = 0; c * SQUARE < GRID.w * CELL; c++) {
      let land = 0;
      for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) {
        const x = c * SQUARE + (a + 0.5) * (SQUARE / 6), z = r * SQUARE + (b + 0.5) * (SQUARE / 6);
        if (ownerAt(x, z) === n && heightAt(WORLD, x, z) > 0.8 && bandAt(x, z) > 0) land++;
      }
      if (land >= 18) { squares++; expect([n, c, r, ps.some((p) => p.x >= c * SQUARE && p.x < (c + 1) * SQUARE && p.z >= r * SQUARE && p.z < (r + 1) * SQUARE)]).toEqual([n, c, r, true]); }
    }
    expect(squares).toBeGreaterThanOrEqual(4);
  });

  test("every playable region's tapes are written, not placeholders", () => {
    for (const [n, ps] of POIS) {
      const tapes = ps.filter((p) => p.kind === "tape");
      expect(tapes.length).toBeGreaterThanOrEqual(4);
      expect(tapes.slice(0, 6).every((p) => !tapeOf(p).placeholder && tapeOf(p).lines.length >= 3 && tapeOf(p).lines.every((l) => /^[A-Z][\w ]+: /.test(l)))).toBe(true);
    }
  });
});

/** Walks in 3 m strides to (tx, tz) along the trail's gates, with `done` sections cleared; the places reached on the way. */
function walkTo(me: Walker, t: ReturnType<typeof newTrek>, tx: number, tz: number, reached: Set<string>): Poi[] {
  const got: Poi[] = [];
  for (let i = 0; i < 8000 && Math.hypot(tx - me.x, tz - me.z) > 1; i++) {
    const dx = tx - me.x, dz = tz - me.z, d = Math.hypot(dx, dz), step = Math.min(3, d) / d;
    trek(me, t, dx * step, dz * step, new Set(), () => 0);
    got.push(...arrive(me, reached));
  }
  return got;
}

describe("walking to a tape and a fire", () => {
  test("the tape plays and is kept in the journal; the fire is lit, rests you, and takes you back from afar", () => {
    const j = newJourney(["hodag", "squonk", "jackalope"])!, g = REGIONS[0]!;
    // The first section is a ring a few kilometres round: its nearest tape and fire to the trailhead are the ones you'd walk to.
    const start = trailhead(1, 0)!, nearest = (kind: Poi["kind"]) => POIS.get(1)!.filter((p) => p.kind === kind && p.k === 0).sort((a, b) => Math.hypot(a.x - start.x, a.z - start.z) - Math.hypot(b.x - start.x, b.z - start.z))[0]!;
    const tape = nearest("tape"), fire = nearest("fire");
    const me: Walker = { ...spawn(1), x: start.x, z: start.z }, t = newTrek(me), reached = new Set<string>();
    expect(ownerAt(me.x, me.z)).toBe(g.n);

    const at = walkTo(me, t, tape.x, tape.z, reached);
    expect(at.map((p) => p.id)).toContain(tape.id);
    expect(findTape(j, tape)).toBe(true);
    const dir = new Director();
    expect(dir.play(found(tapeOf(tape).title, tapeOf(tape).lines, { x: me.x, y: 0, z: me.z }, 0))).toBe(true);
    dir.step(1);
    expect([dir.holding, dir.stage.caption?.text]).toEqual([true, tapeOf(tape).lines[0]!.split(": ")[1]]);
    expect(findTape(j, tape)).toBe(false); // once
    expect(tapesFound(j, 1)).toEqual([tape]);

    const rest = walkTo(me, t, fire.x, fire.z, reached);
    expect(rest.map((p) => p.id)).toContain(fire.id);
    expect(fireSpot(j, fire.id)).toBeUndefined(); // not lit yet
    expect(lightFire(j, fire)).toBe(true);
    const spot = fireSpot(j, fire.id)!;
    expect(Math.hypot(spot.x - fire.x, spot.z - fire.z)).toBeLessThan(4);

    // Standing at it does not rest you again; walking off and back does.
    expect(arrive(me, reached)).toEqual([]);
    walkTo(me, t, fire.x + 20, fire.z, reached);
    expect(walkTo(me, t, fire.x, fire.z, reached).map((p) => p.id)).toContain(fire.id);

    expect(loadJourney(JSON.stringify(j))).toEqual(j);
    expect(loadJourney(JSON.stringify({ ...j, found: undefined, fires: undefined, sights: undefined }))?.fires).toEqual([]); // an older save
  });
});

describe("sighting boards", () => {
  test("two contracts per playable region, each sign and its lair a walk apart on open ground of the region", () => {
    for (const g of trailed) {
      const hs = huntsIn(g.n);
      expect([g.n, hs.length]).toEqual([g.n, 2]);
      for (const h of hs) {
        expect(h.level).toBeGreaterThan(sections(g)[h.k]!.level);
        let at = h.board;
        for (const q of [...h.clues.map((c) => c.at), h.lair]) {
          expect([h.id, ownerAt(q.x, q.z) === g.n && heightAt(WORLD, q.x, q.z) > 0.3 && bandAt(q.x, q.z) > 0]).toEqual([h.id, true]);
          expect(Math.hypot(q.x - at.x, q.z - at.z)).toBeGreaterThan(STEP * 0.8);
          at = q;
        }
      }
    }
  });

  test("take the board, read the three signs in order, find it at its lair, close it", () => {
    const j = newJourney(["hodag", "squonk", "jackalope"])!, h = huntsIn(1)[0]!, open = new Set([1]);
    expect(nextClues(j, 1)).toEqual([]);
    expect(track(j, h.clues[0]!.at)).toEqual([]); // not taken: the spot is just ground
    expect(take(j, h.id)).toBe(true);
    expect(take(j, h.id)).toBe(false);
    // Out of order does nothing: the second sign only shows once the first is read.
    expect(track(j, h.clues[1]!.at)).toEqual([]);
    for (let i = 0; i < CLUES; i++) {
      expect(waiting(j, open)).toEqual([]);
      expect(nextClues(j, 1).map((c) => c.i)).toEqual([i]);
      const read = track(j, { x: h.clues[i]!.at.x + 3, z: h.clues[i]!.at.z });
      expect(read.map((r) => [r.hunt.id, r.last])).toEqual([[h.id, i === CLUES - 1]]);
    }
    expect(waiting(j, open).map((w) => w.id)).toEqual([h.id]);
    expect(waiting(j, new Set([2]))).toEqual([]); // a region not open yet keeps it
    expect(close(j, h.id)).toBe(true);
    expect([j.hunts?.[h.id], waiting(j, open)]).toEqual([DONE, []]);
    expect(loadJourney(JSON.stringify(j))).toEqual(j);
    expect(loadJourney(JSON.stringify({ ...j, hunts: undefined }))?.hunts).toBeUndefined(); // an older save
    expect(HUNTS.size).toBe(trailed.length * 2);
  });
});
