import { expect, test } from "bun:test";
import * as THREE from "three";
import { defaultAvatar } from "@rustybuns/util/avatar";
import { figure } from "../src/studio/figure.ts";
import { Keys, Kit, layout, lowC, type Part } from "../src/studio/played.ts";
import { keysReach, thingBox } from "../src/studio/room.ts";
import { LIVE_ROOM } from "../src/studio/rooms/index.ts";

const spot = (id: string) => LIVE_ROOM.spots.find((s) => s.id === id)!;
/** The spot's thing frame, as main.ts thing() lays it out: its middle on the floor, turned with the seat. */
function inFront(scene: THREE.Scene, id: string) {
  const g = new THREE.Group(), b = thingBox(spot(id));
  g.position.set(b.cx, 0, b.cz); g.rotation.y = b.turn;
  scene.add(g);
  return g;
}
/** Someone sat at the spot, posed for `frames` frames of a 60 Hz page. */
function seated(scene: THREE.Scene, id: string) {
  const s = spot(id), f = figure(defaultAvatar("Pat"), null);
  f.group.position.set(s.at[0], 0, s.at[1]); f.group.rotation.y = s.yaw;
  scene.add(f.group);
  let t = 1;
  return { f, play: (o: Parameters<typeof f.pose>[0]["aim"], frames = 12) => { for (let i = 0; i < frames; i++) f.pose({ speed: 0, seated: true, play: s.kind === "keys" ? "keys" : "sticks", note: true, t: (t += 1 / 60), reach: keysReach(s), sticks: s.kind === "drums", aim: o }); } };
}

test("at the keys, the index finger lands on the very key each note presses, the others lifted; each hand the keys on its own side, and the free one takes the far key of a pair", () => {
  const scene = new THREE.Scene(), s = spot("keys"), t = s.thing, top = t.h, g = inFront(scene, "keys");
  // the stage synth's keys as main.ts lays them
  const n = 29, lay = layout(n), kw = (t.w - 0.12) / n, x0 = -(t.w - 0.12) / 2 + kw / 2, z = t.d * 0.18;
  const whites = lay.whites.map((_, i): [number, number, number] => [x0 + i * kw, top + 0.011, z]);
  const blacks = lay.after.map((i): [number, number, number] => [x0 + (i + 0.5) * kw, top + 0.032, z - t.d * 0.1]);
  const mesh = (w: number, d: number, at: [number, number, number][]) => { const m = new THREE.InstancedMesh(new THREE.BoxGeometry(w, 0.022, d), new THREE.MeshStandardMaterial(), at.length); g.add(m); return m; };
  const keys = new Keys(mesh(kw - 0.003, t.d * 0.5, whites), whites, mesh(kw * 0.58, t.d * 0.3, blacks), blacks, lay, t.d * 0.5, t.d * 0.3);
  const low = lowC(60), { f, play } = seated(scene, "keys");
  /** Which white key a point is over (in the keyboard's frame), and how high over its top. */
  const over = (p: THREE.Vector3) => { const q = g.worldToLocal(p.clone()); return { key: Math.round((q.x - x0) / kw), up: q.y - (top + 0.022) }; };

  for (const [notes, right, left] of [[[64], null, 9], [[76], 16, null], [[50], null, 1], [[64, 69], 12, 9], [[48, 79], 18, 0]] as const) {
    keys.press(notes, low);
    play({ keys, notes: [...notes], low });
    const tips = f.hands.tips();
    for (const [hand, want] of [[tips.right, right], [tips.left, left]] as const) {
      if (want === null) continue;
      const at = over(hand.index);
      expect(at.key).toBe(want);
      // the pad on the key as it's pressed down: its tip joint a pad's radius over where the key sits now
      const pad = hand.index.y - keys.strike(notes[hand === tips.right ? notes.length - 1 : 0], low).y;
      expect(pad).toBeGreaterThan(0.003);
      expect(pad).toBeLessThan(0.016);
      // the fingers either side ride higher, over their own keys
      for (const fg of ["middle", "ring", "little"] as const) expect(over(hand[fg]).up).toBeGreaterThan(at.up + 0.004);
    }
  }
  // nothing sounding: the hands stay over the last keys, lifted off them
  keys.press([], low);
  play({ keys, notes: [], low });
  const rest = f.hands.tips();
  expect(over(rest.right.index).key).toBe(18);
  expect(over(rest.right.index).up).toBeGreaterThan(0.006);
});

test("at the kit, a stick tip lands on the drum or cymbal that's hit, the hand on its side, and lifts off as it rings out", () => {
  const scene = new THREE.Scene(), g = inFront(scene, "drums"), kit = new Kit();
  // the snare and floor tom heads and the two cymbals where main.ts puts them
  for (const [x, y, zz, tip, part, cymbal] of [[-0.3, 0.62, 0.3, 0.12, "snare", false], [0.5, 0.5, 0.25, 0, "tom", false], [-0.62, 1.08, 0.05, 0.2, "hat", true], [0.68, 1.08, -0.15, 0.2, "crash", true]] as const) {
    const holder = new THREE.Group(), head = new THREE.Object3D();
    holder.position.set(x, y, zz); holder.rotation.x = tip;
    head.position.y = cymbal ? 0 : 0.081;
    holder.add(head); g.add(holder);
    kit.add(part, head, new THREE.MeshStandardMaterial(), cymbal);
  }
  const { f, play } = seated(scene, "drums");
  const near = (part: Part, stick: THREE.Vector3) => stick.distanceTo(kit.strike(part)!.at);
  for (const [part, hand] of [["snare", 1], ["crash", 0], ["hat", 1], ["tom", 0]] as const) {
    kit.hit(part);
    play({ kit, notes: [], low: 0 }, 6);
    const sticks = f.hands.stickTips();
    // on the head, a touch in toward the drummer; on a cymbal near its edge
    expect(near(part, sticks[hand])).toBeLessThan(part === "hat" || part === "crash" ? 0.23 : 0.06);
    expect(near(part, sticks[1 - hand])).toBeGreaterThan(0.1);
    // half a second on, ringing out
    for (let i = 0; i < 30; i++) kit.tick(1 / 60, i / 60);
  }
  // rung out, the stick is up off it
  for (let i = 0; i < 60; i++) kit.tick(1 / 60, i / 60);
  play({ kit, notes: [], low: 0 }, 30);
  const up = f.hands.stickTips()[0].y - kit.strike("tom")!.at.y;
  expect(up).toBeGreaterThan(0.1);
});
