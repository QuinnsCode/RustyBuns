import { expect, test } from "bun:test";
import * as THREE from "three";
import { defaultAvatar } from "@rustybuns/util/avatar";
import { drumKit } from "@rustybuns/models/drums";
import { gear } from "@rustybuns/models/gear";
import type { MixSay } from "../src/dj/booth.ts";
import { BoothGear } from "../src/studio/booth-3d.ts";
import { figure, handsOn } from "../src/studio/figure.ts";
import { NECK, fretY } from "../src/studio/fingers.ts";
import { DESERT_GATHERING } from "../src/studio/rooms/desert-gathering.ts";
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

test("at the keys, the index finger lands on the very key each note presses, the others lifted; each hand the keys on its own side, the free one takes the far key of a pair, and a note past either end (Z / X) lands where it folds to", () => {
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

  for (const [notes, right, left] of [[[64], null, 9], [[76], 16, null], [[50], null, 1], [[64, 69], 12, 9], [[48, 79], 18, 0], [[36], null, 0], [[100], 23, null]] as const) {
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
  expect(over(rest.right.index).key).toBe(23);
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

test("at the kit, the ball of the right foot stays on the kick pedal and the left's on the hat's; the heel comes up as each sounds", () => {
  const scene = new THREE.Scene(), g = inFront(scene, "drums"), dk = drumKit({ quality: "low" }), kit = new Kit();
  g.add(dk.group);
  for (const p of dk.pieces) kit.add(p.part, p.obj, p.flash, p.cymbal);
  kit.pedals(dk.pedals);
  const { f, play } = seated(scene, "drums");
  const heelUp = (i: 0 | 1) => { const { heels } = f.feet(); return heels[i].y - kit.pedal(i ? "hat" : "kick")!.at.y; };
  play({ kit, notes: [], low: 0 }, 6);
  const rest = [heelUp(0), heelUp(1)];
  for (const [part, i] of [["kick", 0], ["hat", 1]] as const) {
    kit.hit(part);
    play({ kit, notes: [], low: 0 }, 2);
    const { balls } = f.feet();
    expect(balls[i].distanceTo(kit.pedal(part)!.at)).toBeLessThan(0.02);
    expect(heelUp(i)).toBeGreaterThan(rest[i]! + 0.03);
    // the other foot stays down on its own pedal
    expect(heelUp((1 - i) as 0 | 1)).toBeLessThan(rest[1 - i]! + 0.01);
    for (let n = 0; n < 60; n++) kit.tick(1 / 60, n / 60);
  }
});

test("with a guitar in, the fretting hand closes round the neck at the fret and the pick swings across the strings while it sounds", () => {
  const scene = new THREE.Scene(), f = figure(defaultAvatar("Pat"), null);
  f.group.position.set(1, 0, 2); f.group.rotation.y = 0.7;
  scene.add(f.group);
  let t = 1;
  for (const seated of [false, true]) {
    const strum = (level: number, frames: number) => { const xs: number[] = []; for (let i = 0; i < frames; i++) { f.pose({ speed: 0, seated, play: handsOn(undefined, false, true), note: false, t: (t += 1 / 60), guitar: level }); xs.push(inGuitar(f.hands.tips().right.index).x); } return Math.max(...xs) - Math.min(...xs); };
    /** A point in the held guitar's own frame (the neck up +y, the strings' face +z). */
    const inGuitar = (p: THREE.Vector3) => p.clone().applyMatrix4(f.strum()!.guitar.matrixWorld.clone().invert());
    const swing = strum(0.5, 40), tips = f.hands.tips();
    // the index on the fretboard at the 3rd fret, the thumb behind the neck
    const index = inGuitar(tips.left.index), thumb = inGuitar(tips.left.thumb);
    expect(Math.abs(index.y - fretY(3))).toBeLessThan(0.01);
    expect(index.z).toBeGreaterThan(NECK.z + 0.01);
    expect(thumb.z).toBeLessThan(NECK.z);
    // the pick by the pickups, on the strings, swinging across them
    const pick = inGuitar(tips.right.index);
    expect(Math.abs(pick.y - NECK.pickY)).toBeLessThan(0.06);
    expect(Math.abs(pick.z - NECK.face)).toBeLessThan(0.02);
    expect(swing).toBeGreaterThan(0.06);
    // the guitar quiet, the hand stays where it is
    strum(0, 30);
    expect(strum(0, 20)).toBeLessThan(0.002);
  }
  // unplugged: no guitar drawn
  f.pose({ speed: 0, seated: false, play: null, note: false, t: (t += 1 / 60), guitar: null });
  expect(f.strum()!.guitar.visible).toBe(false);
});

test("at the DJ table, a hand goes to what the decks say was touched: play on deck A, a hot cue pressed on B from across the room, then back to the jog", () => {
  const scene = new THREE.Scene(), s = DESERT_GATHERING.spots.find((x) => x.kind === "dj")!, g = new THREE.Group(), b = thingBox(s), booth = new BoothGear();
  g.position.set(b.cx, 0, b.cz); g.rotation.y = b.turn;
  scene.add(g);
  // the decks as main.ts lays them: either side of the mixer, their fronts in one line toward the DJ
  const front = s.thing.d / 2 - 0.08, decks = [0, 1].map((side) => {
    const deck = gear("deck-cd");
    deck.position.set((side ? 1 : -1) * 0.35, s.thing.h, front - 0.405 / 2);
    g.add(deck); booth.add(deck, side ? 1 : 0);
    return deck;
  });
  const f = figure(defaultAvatar("Pat"), null);
  f.group.position.set(s.at[0], 0, s.at[1]); f.group.rotation.y = s.yaw;
  scene.add(f.group);
  const view = { name: "Song", who: "Pat", bpm: 124, key: null, pos: 10, len: 200, playing: false, cue: 0, wave: new Float32Array(0) };
  let t = 1;
  const frames = (n: number) => { for (let i = 0; i < n; i++) { t += 1 / 60; booth.frame((side) => (side === 0 ? view : null), t); f.pose({ speed: 0, seated: true, play: handsOn("dj", false), note: false, t, aim: { notes: [], low: 0, touch: booth.hands(t) ?? undefined } }); } };
  const at = (deck: THREE.Object3D, part: string) => deck.getObjectByName(part)!.getWorldPosition(new THREE.Vector3());
  frames(10);
  // deck A starts playing: the left index down on its PLAY key
  view.playing = true;
  frames(6);
  expect(f.hands.tips().left.index.distanceTo(at(decks[0]!, "part:play"))).toBeLessThan(0.02);
  // someone presses hot cue 2 on deck B: the right hand goes to its pad, the left still over PLAY
  booth.reached(1, "hot2", t);
  frames(6);
  const hot2 = decks[1]!.localToWorld(new THREE.Vector3(-0.023, 0.09, -0.08));
  expect(f.hands.tips().right.index.distanceTo(hot2)).toBeLessThan(0.025);
  // a while later, each hand back on its own jog's rim
  frames(120);
  for (const [i, hand] of [[0, "left"], [1, "right"]] as const) {
    const jog = at(decks[i]!, "part:platter"), tip = f.hands.tips()[hand].index;
    expect(Math.abs(Math.hypot(tip.x - jog.x, tip.z - jog.z) - 0.09)).toBeLessThan(0.03);
  }
});

test("at the DJ table, the mixer moves as the DJ's says: channel 2's fader goes up under the left index, the crossfader over to B under the right", () => {
  const scene = new THREE.Scene(), s = DESERT_GATHERING.spots.find((x) => x.kind === "dj")!, g = new THREE.Group(), b = thingBox(s), booth = new BoothGear();
  g.position.set(b.cx, 0, b.cz); g.rotation.y = b.turn;
  scene.add(g);
  // the mixer and the decks as main.ts lays them out
  const front = s.thing.d / 2 - 0.08, mixer = gear("mixer-club-4");
  mixer.position.set(0, s.thing.h, front - 0.358 / 2);
  g.add(mixer); booth.addRest(mixer, true);
  for (const side of [0, 1] as const) {
    const deck = gear("deck-cd");
    deck.position.set((side ? 1 : -1) * 0.35, s.thing.h, front - 0.405 / 2);
    g.add(deck); booth.add(deck, side);
  }
  const f = figure(defaultAvatar("Pat"), null);
  f.group.position.set(s.at[0], 0, s.at[1]); f.group.rotation.y = s.yaw;
  scene.add(f.group);
  let t = 1;
  const frames = (n: number) => { for (let i = 0; i < n; i++) { t += 1 / 60; booth.frame(() => null, t); f.pose({ speed: 0, seated: true, play: handsOn("dj", false), note: false, t, aim: { notes: [], low: 0, touch: booth.hands(t) ?? undefined } }); } };
  const cap = (part: string) => mixer.getObjectByName(part)!;
  const say = (o: Partial<MixSay> = {}): MixSay => ({ t: "mix", faders: [0.5, 0.5, 0.5, 0.5], cross: 0, filters: [0.6, 0.3], eq: Array(16).fill(0), ...o });
  // what the mixer said when this page came in: the caps go there, no hand moves
  booth.mixed(say(), t);
  frames(10);
  const was = cap("part:fader-2").position.z;
  // deck A's channel up: its cap slides away from the DJ, the left index riding it
  booth.mixed(say({ faders: [0.5, 1, 0.5, 0.5] }), t);
  frames(20);
  expect(cap("part:fader-2").position.z).toBeCloseTo(was - 0.03, 3);
  const top = (part: string) => cap(part).localToWorld(new THREE.Vector3(0, 0.012, 0));
  expect(f.hands.tips().left.index.distanceTo(top("part:fader-2"))).toBeLessThan(0.02);
  // the crossfader over to B: the right hand on it, the left still on its fader
  booth.mixed(say({ faders: [0.5, 1, 0.5, 0.5], cross: 0.8 }), t);
  frames(20);
  expect(cap("part:cross").position.x).toBeCloseTo(0.8 * 0.045 / 2, 3);
  expect(f.hands.tips().right.index.distanceTo(top("part:cross"))).toBeLessThan(0.02);
  // filter 2 swept down: its knob turns back anticlockwise (seen from above), the right hand on it
  booth.mixed(say({ faders: [0.5, 1, 0.5, 0.5], cross: 0.8, filters: [0.6, 0.1] }), t);
  frames(20);
  expect(cap("part:filter-2").rotation.y).toBeGreaterThan(cap("part:filter-1").rotation.y);
  expect(f.hands.tips().right.index.distanceTo(cap("part:filter-2").localToWorld(new THREE.Vector3(0, 0.013, 0)))).toBeLessThan(0.02);
});
