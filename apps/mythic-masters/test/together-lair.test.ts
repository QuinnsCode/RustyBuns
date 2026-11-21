// Two friends in one room (together-kit.ts), and one fight at one den, joined together (#4063).
import { expect, setDefaultTimeout, test } from "bun:test";
import { chromePath } from "../../../scripts/chrome.ts";
import { noise, settle, stride, together, until } from "./together-kit.ts";

setDefaultTimeout(300_000);

test.skipIf(!chromePath())("two friends at one lair fight the one creature there", () => together(async ({ open }) => {
  const a = await open("hodag");
  const b = await open("squonk");
  // Both land by the campfire 377 m from the first contract's lair and walk over at a pace the room believes; there each
  // tells the other it read the last sign (believed that close to the lair), so the Rougarou waits there for both. A walks
  // into it, and B hears who is fighting what, and where. B walks in too: the same creature at the same level, and the
  // same health: A wears it down to half, and B's creature is down to half too. A's fight ends (worn down, so it is
  // quick), and B hears how it went.
  const first = "1.19074.1638", lair = { x: 19426, z: 2391.2 }, fire = { x: 19490, z: 2763 };
  const ready = (dx: number) => `(async () => { mythicMasters.world.peace(true); mythicMasters.world.teleport(${fire.x + dx}, ${fire.z}); ${settle} })()`;
  await Promise.all([a.eval(ready(12)), b.eval(ready(-12))]);
  // To 25 m short of the lair, then on with the wild ones awake.
  await Promise.all([stride(a, lair.x, lair.z, 25), stride(b, lair.x, lair.z, 25)]);
  await Promise.all([a.eval(`mythicMasters.together.hunt("${first}", 3)`), b.eval(`mythicMasters.together.hunt("${first}", 3)`)]);
  const lastSign = `(() => { const s = mythicMasters.world.state(); return { stage: mythicMasters.journey.state()?.hunts?.["${first}"] ?? null, x: Math.round(s.x), z: Math.round(s.z), r: s.region, room: mythicMasters.together.state()?.status }; })()`;
  type Sign = { stage: number | null };
  await Promise.all([until(() => a.eval<Sign>(lastSign), (s) => s.stage === 3), until(() => b.eval<Sign>(lastSign), (s) => s.stage === 3)]);
  type Trip = { kind: string; foe: { id: string; level: number } } | null;
  const into = `(async () => { const w = mythicMasters.world; w.peace(false); for (let i = 0; i < 10 && !mythicMasters.journey.trip(); i++) { const s = w.state(); w.teleport(s.x + (${lair.x} - s.x) / 2, s.z + (${lair.z} - s.z) / 2); await new Promise((r) => setTimeout(r, 400)); } return mythicMasters.journey.trip(); })()`;
  const aTrip = await a.eval<Trip>(into);
  expect(aTrip?.foe).toMatchObject({ id: "rougarou", level: 9, hunt: first });
  type Fight = { den: string; c: string; won?: boolean };
  const heard = "mythicMasters.together.state().fights";
  await until(() => b.eval<Fight[]>(heard), (fs) => fs.some((x) => x.den === `hunt:${first}` && x.c === "rougarou"));
  const bTrip = await b.eval<Trip>(into);
  expect(bTrip?.foe).toEqual(aTrip?.foe);
  // A fight report is believed only once it has lasted 3 s (party.ts FIGHT), by the fight's own clock: 4 s of ticks
  // (a CI runner's page ticks slower than the wall clock).
  await until(() => a.eval<number>(`mythicMasters.state()?.tick ?? 0`), (t) => t >= 4 * 60, 90_000);
  await a.eval(`mythicMasters.journey.wear(0.5)`);
  type Lair = { den: string; hp: number; friends: Record<string, number> } | null;
  const lairOf = "mythicMasters.together.state()?.lair ?? null";
  await until(() => b.eval<Lair>(lairOf), (l) => !!l && l.den === `hunt:${first}` && l.hp <= 0.52, 20_000);
  await a.eval(`mythicMasters.journey.wear(0.01, 0)`);
  const aFight = "(() => { const s = mythicMasters.state(); return s && { tick: s.tick, over: s.over, winner: s.winner, hp: s.fighters.map((f) => f.hp) }; })()";
  await until(() => Promise.all([b.eval<Fight[]>(heard), a.eval<unknown>(aFight)]), ([fs]) => fs.some((x) => x.c === "rougarou" && x.won === false), 60_000);
  expect(noise(a, b)).toEqual([]);
}));
