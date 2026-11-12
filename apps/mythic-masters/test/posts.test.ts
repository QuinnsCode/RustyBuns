import { expect, setDefaultTimeout, test } from "bun:test";
import { FACTION, postId } from "../src/factions/engine.ts";
import { FACTIONS } from "../src/factions/model.ts";
import { postSpot, stageSpot, TALK_R, walkedUp, type Spot } from "../src/world/posts.ts";
import { WORLD } from "../src/world/trail.ts";
import { dry, ownerAt } from "../src/world/world.ts";

setDefaultTimeout(30_000);

test("every quest person and post has a dry spot of its own by its stone, and speaks once a visit", () => {
  // everyone who can stand at one stone, by section
  const bySection = new Map<string, { id: string; n: number; at: Spot | undefined; again: Spot | undefined }[]>();
  const put = (id: string, n: number, k: number, spot: () => Spot | undefined) => {
    const list = bySection.get(`${n}:${k}`) ?? [];
    list.push({ id, n, at: spot(), again: spot() });
    bySection.set(`${n}:${k}`, list);
  };
  for (const f of FACTIONS) {
    for (const st of FACTION[f].quest) put(st.id, st.n, st.k, () => stageSpot(f, st.n, st.k));
    for (const p of FACTION[f].posts) put(postId(f, p), p.n, p.k, () => postSpot(postId(f, p)));
  }
  const all = [...bySection.values()].flat();
  expect(all.length).toBe(3 * (8 + 24));
  const placed: (Spot & { id: string })[] = [];
  for (const p of all) {
    if (!p.at) throw new Error(`${p.id} has nowhere to stand`);
    expect(p.again).toEqual(p.at);
    expect([p.id, ownerAt(p.at.x, p.at.z), dry(WORLD, p.at.x, p.at.z)]).toEqual([p.id, p.n, true]);
    placed.push({ id: p.id, ...p.at });
  }
  const at = new Map(placed.map((p) => [p.id, p]));
  for (const list of bySection.values()) for (const a of list) for (const b of list) {
    if (a.id >= b.id) continue;
    const p = at.get(a.id)!, q = at.get(b.id)!;
    expect([a.id, b.id, Math.hypot(p.x - q.x, p.z - q.z) >= 6]).toEqual([a.id, b.id, true]);
  }

  // walk up to one: it speaks once, stays quiet while you stand there, and speaks again only after you have left
  const who = placed[0]!, reached = new Set<string>(), near = { x: who.x + 1, z: who.z }, away = { x: who.x + TALK_R * 2 + 1, z: who.z };
  expect(walkedUp(near, [who], reached).map((p) => p.id)).toEqual([who.id]);
  expect(walkedUp(near, [who], reached)).toEqual([]);
  expect(walkedUp({ x: who.x + TALK_R + 1, z: who.z }, [who], reached)).toEqual([]);
  expect(walkedUp(near, [who], reached)).toEqual([]);
  expect(walkedUp(away, [who], reached)).toEqual([]);
  expect(walkedUp(near, [who], reached).map((p) => p.id)).toEqual([who.id]);
});
