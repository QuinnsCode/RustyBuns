import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { int, obj, oneOf, str } from "@rustybuns/util/guard";
import { LAND, loadPack, PACKS, packInSeason, roamingEvents } from "../src/packs.ts";
import { REGIONS, sacredIds } from "../src/regions.ts";
import { ARCHETYPES, ROSTER } from "../src/roster.ts";
import { inSeason, tierOf } from "../src/tiers.ts";
import { PLACES } from "../src/world/places.ts";
import * as THREE from "three";
import { findTape, ISLE_N, isleLair, islePlaces, isleTapesFound, lightFire, MIN_GAP, tapeOf, type Log } from "../src/world/poi.ts";
import { poiView, type PoiView } from "../src/world/poi-view.ts";
import { CLUES, isleHunts, stageOf, take } from "../src/world/hunts.ts";
import { atSlip, isleGround, isleSlip, onDock, portSlip } from "../src/world/ferry.ts";
import { WORLD } from "../src/world/trail.ts";
import { buildIsland, CELL, dry, heightAt, islandFrom, onIsland, poolOf, regionAt, spawn, walk } from "../src/world/world.ts";

// Every pack in packs/ loads and holds to the rules in src/packs.ts: its beasts are new, from a legend with sources,
// never a being held sacred; its island sits off the coast by its port; its event creatures are in season with it.
const DIR = join(import.meta.dir, "..", "packs");
const Sheet = obj({ id: str(40, { re: /^[a-z0-9-]+$/ }), name: str(40), about: str(600, { min: 40 }), archetype: oneOf(ARCHETYPES), feet: int(0, 8) });
const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const island = async (p: { id: string }) => buildIsland(islandFrom(new Uint8Array(await Bun.file(join(import.meta.dir, "..", "public", "packs", p.id, "ground.bin")).arrayBuffer()))!);
type At = { x: number; z: number };
/** Walks `at` to `goal` as the keys do, a metre a frame, over 50 m squares of dry ground (a flood from where you stand),
 *  ticking the island's places each frame; their toasts come back. */
function walkTo(w: ReturnType<typeof buildIsland>, s: ReturnType<typeof isleSlip>, view: PoiView, at: At, goal: At): string[] {
  const S = 50, cols = Math.floor(w.width / S), rows = Math.floor(w.depth / S);
  const cell = (q: At) => Math.round(q.z / S) * cols + Math.round(q.x / S), from = new Int32Array(cols * rows).fill(-1);
  const queue = [cell(at)];
  from[queue[0]!] = queue[0]!;
  for (let k = 0; k < queue.length && from[cell(goal)]! < 0; k++) {
    const i = queue[k]!, c = i % cols, r = Math.floor(i / cols);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n = (r + dr) * cols + c + dc;
      if (c + dc < 0 || r + dr < 0 || c + dc >= cols || r + dr >= rows || from[n]! >= 0 || !dry(w, (c + dc) * S, (r + dr) * S)) continue;
      from[n] = i; queue.push(n);
    }
  }
  const route: At[] = [{ x: goal.x, z: goal.z }];
  for (let i = from[cell(goal)]!; i !== cell(at); i = from[i]!) route.unshift({ x: (i % cols) * S, z: Math.floor(i / cols) * S });
  const toasts: string[] = [];
  for (const g of route) for (let k = 0; k < 200 && Math.hypot(g.x - at.x, g.z - at.z) > 1; k++) {
    const d = Math.hypot(g.x - at.x, g.z - at.z), x = at.x + ((g.x - at.x) / d) * Math.min(1, d), z = at.z + ((g.z - at.z) / d) * Math.min(1, d);
    if (isleGround(w, s, x, z)) { at.x = x; at.z = z; }
    toasts.push(...view.update(1 / 60, at, new Set([ISLE_N])));
  }
  return toasts;
}
const cells = (c: readonly [number, number]) => Array.from({ length: LAND[0] * LAND[1] }, (_, i) => [c[0] + (i % LAND[0]), c[1] + Math.floor(i / LAND[0])] as const);

describe("packs", () => {
  test("every folder in packs/ is a loaded pack, and no two share an id or a beast", async () => {
    expect(PACKS.map((p) => p.id).sort()).toEqual(readdirSync(DIR).sort());
    const packed = new Set(PACKS.flatMap((p) => Object.keys(p.fighters)));
    const seen = new Set(ROSTER.map((c) => c.id).filter((id) => !packed.has(id)));
    for (const p of PACKS) for (const f of readdirSync(join(DIR, p.id, "beasts"))) {
      const id = f.replace(/\.json$/, "");
      expect([p.id, id, seen.has(id)]).toEqual([p.id, id, false]);
      seen.add(id);
    }
  });

  test.each(PACKS.map((p) => [p.id, p] as const))("%s: 3-6 beasts, each with its legend, sources, and nothing sacred", async (_, p) => {
    const files = readdirSync(join(DIR, p.id, "beasts"));
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files.length).toBeLessThanOrEqual(6);
    const ids = await Promise.all(files.map(async (f) => {
      const sheet = Sheet(await Bun.file(join(DIR, p.id, "beasts", f)).json());
      expect(`${sheet.id}.json`).toBe(f);
      // Each beast fights as its sheet is built: one roster row from the pack, the same shape, an event of its season.
      const c = ROSTER.find((r) => r.id === sheet.id);
      expect([sheet.id, c?.name, c?.archetype, tierOf(sheet.id), p.events.includes(sheet.id)]).toEqual([sheet.id, sheet.name, sheet.archetype, "event", true]);
      return sheet.id;
    }));
    expect(Object.keys(p.lore.legends).sort()).toEqual([...ids].sort());
    const sacred = new Set([...sacredIds, ...p.lore.sacred.map(slug)]);
    for (const id of [...ids, ...p.events]) expect([id, sacred.has(id)]).toEqual([id, false]);
    for (const s of p.lore.sacred) expect(Object.values(p.lore.legends).some((l) => l.sacred.includes(s))).toBe(true); // each is said why
  });

  test.each(PACKS.map((p) => [p.id, p] as const))("%s: an island off the coast by its port, with its own places", (_, p) => {
    const taken = new Set(Object.values(PLACES).map((pl) => pl.cell.join()));
    const mine = cells(p.land.cell);
    for (const c of mine) expect([c.join(), taken.has(c.join())]).toEqual([c.join(), false]);
    for (const o of PACKS) if (o !== p) for (const c of cells(o.land.cell)) expect(mine.some((m) => m.join() === c.join())).toBe(false);
    const port = PLACES[p.land.port]!.cell;
    expect(REGIONS[p.land.port - 1]!.tier).toBe("playable");
    expect(Math.min(...mine.map(([x, z]) => Math.max(Math.abs(x - port[0]), Math.abs(z - port[1]))))).toBe(1);
    // A place to land and rest, every tape with something on it, and room between them on the island's own map.
    expect(p.places.some((s) => s.kind === "fire")).toBe(true);
    // Its lair opens at one of those places, on dry ground, and whoever waits in it is a fighter in the roster.
    const den = isleLair(p);
    expect([den?.name, ROSTER.some((c) => c.id === p.lair.foe)]).toEqual([p.lair.place, true]);
    for (const s of p.places) expect([s.name, s.kind === "tape"]).toEqual([s.name, s.tape !== undefined]);
    const w = LAND[0] * CELL, h = LAND[1] * CELL;
    for (const [i, a] of p.places.entries()) for (const b of p.places.slice(i + 1))
      expect([a.name, b.name, Math.hypot((a.at[0] - b.at[0]) * w, (a.at[1] - b.at[1]) * h) >= MIN_GAP]).toEqual([a.name, b.name, true]);
  });

  test.each(PACKS.map((p) => [p.id, p] as const))("%s: off the boat at its first fire, you walk dry ground to every tape", async (_, p) => {
    const bytes = new Uint8Array(await Bun.file(join(import.meta.dir, "..", "public", "packs", p.id, "ground.bin")).arrayBuffer());
    const w = buildIsland(islandFrom(bytes)!), S = 50, cols = Math.floor(w.width / S), rows = Math.floor(w.depth / S);
    const at = (uv: readonly [number, number]) => { const { x, z } = onIsland(uv); return Math.round(z / S) * cols + Math.round(x / S); };
    // Flood out from the landing fire over dry ground, 50 m a step: every tape and fire it reaches, you can walk back from.
    const fire = p.places.find((s) => s.kind === "fire")!, seen = new Uint8Array(cols * rows), queue = [at(fire.at)];
    expect(dry(w, onIsland(fire.at).x, onIsland(fire.at).z)).toBe(true);
    seen[queue[0]!] = 1;
    for (let k = 0; k < queue.length; k++) {
      const i = queue[k]!, c = i % cols, r = Math.floor(i / cols);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const cc = c + dc, rr = r + dr, j = rr * cols + cc;
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows || seen[j] || !dry(w, cc * S, rr * S)) continue;
        seen[j] = 1; queue.push(j);
      }
    }
    for (const s of p.places.filter((s) => s.kind === "tape" || s.kind === "fire")) expect([s.name, seen[at(s.at)]]).toEqual([s.name, 1]);
    // And it is an island: the map's edge is open sea all round.
    for (let c = 0; c < cols; c++) expect([c, seen[c], seen[(rows - 1) * cols + c]]).toEqual([c, 0, 0]);
  });

  test.each(PACKS.filter((p) => p.tier !== "coming-soon").map((p) => [p.id, p] as const))("%s: the boat from the port town to the landing fire and back", async (_, p) => {
    // On the continent: you board by the boat, out on the sea past the port region's ground, and walk() takes you there from the town along the pier.
    const port = portSlip(WORLD, p), me = { ...spawn(p.land.port), x: port.land.x, z: port.land.z };
    expect([regionAt(port.land.x, port.land.z)?.n, regionAt(port.x, port.z)?.n, Math.hypot(port.x - port.boat.x, port.z - port.boat.z) < 10, heightAt(WORLD, port.boat.x, port.boat.z) < 0]).toEqual([p.land.port, undefined, true, true]);
    const towards = (s: { x: number; z: number }, at: { x: number; z: number }, step: (dx: number, dz: number) => void) => {
      for (let k = 0; k < 2000 && !atSlip(s, at.x, at.z); k++) { const d = Math.hypot(s.x - at.x, s.z - at.z); step(((s.x - at.x) / d) * 1.5, ((s.z - at.z) / d) * 1.5); }
      return atSlip(s, at.x, at.z);
    };
    expect(towards(port, me, (dx, dz) => walk(me, dx, dz, new Set(), undefined, undefined, (x, z) => onDock(port, x, z)))).toBe(true);
    expect(me.region).toBe(p.land.port);
    // On the island: off the boat by the first fire, on dry ground, and back to its slip over the island's ground and the dock.
    const bytes = new Uint8Array(await Bun.file(join(import.meta.dir, "..", "public", "packs", p.id, "ground.bin")).arrayBuffer());
    const w = buildIsland(islandFrom(bytes)!), s = isleSlip(w, p), at = { ...s.land };
    expect([Math.hypot(at.x - s.fire.x, at.z - s.fire.z) < 10, dry(w, at.x, at.z), heightAt(w, s.boat.x, s.boat.z) < 0]).toEqual([true, true, true]);
    expect(towards(s, at, (dx, dz) => { if (isleGround(w, s, at.x + dx, at.z + dz)) { at.x += dx; at.z += dz; } })).toBe(true);
  });

  test.each(PACKS.filter((p) => p.tier !== "coming-soon").map((p) => [p.id, p] as const))("%s: off the boat, you walk to a tape, it plays, and the journal keeps it", async (_, p) => {
    const w = await island(p), s = isleSlip(w, p), at = { ...s.land }, all = islePlaces(p), j: Log = { found: [], fires: [], sights: [] };
    // The island's places as view.ts draws them, with the hooks main.ts gives it: a tape found once, a fire lit.
    const played: string[] = [];
    const view = poiView(new THREE.Group(), new THREE.PerspectiveCamera(), (x, z) => heightAt(w, x, z), {
      log: () => j,
      reach: (q) => { if (q.kind === "tape" && findTape(j, q)) { played.push(tapeOf(q).title); return `Found a tape: ${tapeOf(q).title}`; } if (q.kind === "fire") lightFire(j, q); },
      sight: () => {},
    }, undefined, { all, near: () => all, region: () => ISLE_N });
    // Walk dry ground from where the boat puts you to the first tape.
    const tape = all.find((q) => q.kind === "tape")!, toasts = walkTo(w, s, view, at, tape);
    const title = p.places.find((q) => q.kind === "tape")!.tape!.title;
    expect([Math.hypot(tape.x - at.x, tape.z - at.z) < 1, played, toasts.filter((t) => t.includes("Found a tape")).length]).toEqual([true, [title], 1]);
    // The journal's page for the island has it, and walking past again doesn't play it twice.
    expect(isleTapesFound(j, p).map((q) => tapeOf(q).title)).toEqual([title]);
    for (let k = 0; k < 20; k++) view.update(1 / 60, { x: at.x + k, z: at.z }, new Set([ISLE_N]));
    expect(played).toEqual([title]);
  });

  test.each(PACKS.filter((p) => p.board).map((p) => [p.id, p] as const))("%s: read the sighting board, follow its signs, and its creature waits in the lair", async (_, p) => {
    const w = await island(p), s = isleSlip(w, p), at = { ...s.land }, all = islePlaces(p), j: Log = { found: [], fires: [], sights: [] };
    // main.ts's hook: the board's first visit takes its contract.
    const view = poiView(new THREE.Group(), new THREE.PerspectiveCamera(), (x, z) => heightAt(w, x, z), {
      log: () => j, reach: (q) => { if (q.kind === "board" && take(j, q.id)) return "taken"; }, sight: () => {},
    }, undefined, { all, near: () => all, region: () => ISLE_N, hunts: isleHunts(p) });
    const [h] = isleHunts(p), board = all.find((q) => q.kind === "board")!;
    expect([h?.id, h?.creature, h?.lair]).toEqual([board.id, p.lair.foe, { x: isleLair(p)!.x, z: isleLair(p)!.z }]);
    walkTo(w, s, view, at, board);
    expect(stageOf(j, h!.id)).toBe(0);
    // Each sign read in turn, the last saying its creature is close; then it waits at the lair (the lair fight closes it).
    const signOf = (t: string) => h!.clues.findIndex((c) => t.includes(c.sign));
    const read = h!.clues.flatMap((c) => walkTo(w, s, view, at, c.at).filter((t) => signOf(t) >= 0));
    expect(read.map(signOf)).toEqual([0, 1, 2]);
    expect([read[2]!.includes(`${h!.title} is close`), stageOf(j, h!.id)]).toEqual([true, CLUES]);
  });

  test("in its season a pack's event creatures roam the whole continent, and out of it they don't", () => {
    const yule = PACKS.find((p) => p.id === "yule-isle")!, dec = new Date(2026, 11, 24), jul = new Date(2026, 6, 4);
    expect(yule.events).toContain("yule-cat");
    for (const p of PACKS) for (const id of p.events) {
      const first = new Date(2026, p.season.from[0] - 1, p.season.from[1]);
      expect([id, tierOf(id), inSeason(id, first), packInSeason(p, first)]).toEqual([id, "event", true, true]);
    }
    expect([...roamingEvents(dec)].sort()).toEqual(["gryla", "kallikantzaros", "krampus", "yule-cat"]);
    expect(yule.lair.foe).toBe("gryla"); // her kitchen is hers now the Yule Isle's beasts fight
    expect(roamingEvents(jul).size).toBe(0);
    // The Yule Cat is Iceland's (34), far from the Pine Barrens: there only in December.
    expect(poolOf(1, dec)).toContain("yule-cat");
    expect(poolOf(1, jul)).not.toContain("yule-cat");
  });

  test.each([
    ["a month that isn't one", { pack: { season: { from: [13, 1], to: [1, 6] } } }, /season\.from/],
    ["a picture under a licence we can't ship", { pack: { credits: [{ what: "a card", by: "someone", licence: "All rights reserved" }] } }, /credits\.0\.licence/],
    ["a lair with a critter nobody draws", { pocket: { critters: [{ kind: "wolves", n: 3 }] } }, /yule-isle: .*critters\.0\.kind/],
    ["a tape line with no speaker", { poi: [{ kind: "tape", name: "x", at: [0, 0], tape: { title: "x", lines: ["something walked past"] } }] }, /yule-isle: .*lines\.0/],
  ] as const)("a pack with %s doesn't load", async (_, bad, why) => {
    const read = (f: string) => Bun.file(join(DIR, "yule-isle", f)).json();
    const files = { pack: await read("pack.json"), pocket: await read("pocket.json"), poi: await read("poi.json"), lore: await read("lore.json"), director: await read("director.json") };
    const pack = "pack" in bad ? { ...files.pack, ...bad.pack } : files.pack, pocket = "pocket" in bad ? { ...files.pocket, ...bad.pocket } : files.pocket;
    expect(() => loadPack({ ...files, ...bad, pack, pocket })).toThrow(why);
  });
});
