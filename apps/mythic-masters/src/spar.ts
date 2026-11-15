// The Book's five, shadow-boxing on their cards (#4670): each beast in a window on its card, alone, running
// drills on the fight's own sim (sim.ts), so its pace, its reach and how long a blow takes are the ones it fights
// with. A drill for each stat, in turn, with a line saying what that stat does; pointing at a stat's word on the
// radar jumps to its drill. One see-through canvas over the page draws all five (a scissor a card), never five
// WebGL views, and only while the Book's page is up.
import * as THREE from "three";
import { loadBeast, Puppet } from "./beasts.ts";
import { FX_AMOUNT } from "./effects.ts";
import { tierOf } from "./tiers.ts";
import type { Creature } from "./roster.ts";
import { HZ, IDLE, newMatch, step, type Input, type Match } from "./sim.ts";

export const STATS = ["speed", "might", "guard", "vigor", "focus", "will"] as const;
export type Stat = (typeof STATS)[number];

/** What each stat does, in a line (sim.ts and roster.ts `body` are where it is true). */
export const MEANS: Record<Stat, string> = {
  speed: "Speed: how fast it runs and turns.",
  might: "Might: how hard its bites and blows land.",
  guard: "Guard: how well it shrugs off blows.",
  vigor: "Vigor: how much it can take, and how long before it tires.",
  focus: "Focus: how hard its shots and breath land.",
  will: "Will: how well it shrugs off shots and breath.",
};

/** A drill: inputs held for so many ticks. A press (`light`, `dash` ...) is held one tick, then let go. */
type Beat = [Partial<Input>, number];
const press = (k: keyof Input, mx = 0): Beat[] => [[{ [k]: true, mx }, 1], [{ mx }, 1]];
const fwd = (n: number): Beat => [{ mx: 1 }, n], back = (n: number): Beat => [{ mx: -1 }, n], wait = (n: number): Beat => [{}, n];
export const DRILLS: Record<Stat, Beat[]> = {
  // runs out and back: a quick one covers the ground in a blink, a heavy one lumbers
  speed: [fwd(55), wait(10), back(55), wait(20)],
  // two of its heaviest blows
  might: [fwd(8), ...press("heavy"), wait(55), ...press("heavy"), wait(55), back(8)],
  // shells up and takes its time behind it
  guard: [[{ guard: true }, 80], wait(30)],
  // dash after dash until it tires
  vigor: [...press("dash", 1), wait(18), ...press("dash", 1), wait(18), ...press("dash", 1), wait(18), wait(20)],
  // its special: a shot, a breath, whatever its legend throws
  focus: [...press("special"), wait(75), ...press("special"), wait(60)],
  // braces behind its guard, then a jump to shake it off
  will: [[{ guard: true }, 55], ...press("up"), wait(45)],
};

/** Where in its drills a beast is: which stat, and the tick into it. */
export interface Drill { stat: Stat; beat: number; left: number; /** set when a drill starts over: back to the mark */ top?: boolean }

/** The next tick of a beast's drills: the input to hold now. Moves on to the next stat when one runs out
 * (`hold` keeps it on that stat instead, looping it, while a pointer rests on its word). */
export function drillInput(d: Drill, hold: Stat | null): Input {
  if (hold && hold !== d.stat) { d.stat = hold; d.beat = 0; d.left = DRILLS[hold][0]![1]; d.top = true; }
  const beats = DRILLS[d.stat];
  while (d.left <= 0) {
    d.beat++;
    if (d.beat >= beats.length) { d.beat = 0; d.top = true; if (!hold) d.stat = STATS[(STATS.indexOf(d.stat) + 1) % STATS.length]!; }
    d.left = DRILLS[d.stat][d.beat]![1];
  }
  d.left--;
  return { ...IDLE, ...DRILLS[d.stat][d.beat]![0] };
}

const START = -7; // where it stands to begin a drill; a mark on the far side of the ring, never reached, is what it faces
/** A sim of one beast, alone: the other side stands far off, out of reach and untouchable, so it only gives a heading. */
export function sparMatch(c: Creature): Match {
  const m = newMatch(c, c);
  m.f[0].pos = { x: START, y: 0, z: 0 };
  m.f[1].pos = { x: 14, y: 0, z: 0 };
  return m;
}
/** One tick of a beast's drill; it is set back on its mark between drills, and the far mark kept whole. */
export function sparStep(m: Match, d: Drill, hold: Stat | null): Match {
  const input = drillInput(d, hold), f = m.f[0];
  if (d.top) { d.top = false; f.pos.x = START; f.pos.z = 0; f.vel.x = f.vel.z = 0; }
  const far = m.f[1];
  far.invuln = 999; far.hp = far.b.hp; far.pos.x = 14; far.pos.z = 0;
  step(m, [input, IDLE]);
  if (m.over) return sparMatch(m.f[0].c);
  return m;
}

interface Slot { c: Creature; m: Match; d: Drill; p: Puppet | null; height: number; el: () => HTMLElement | null }

/** The five on their cards. `windows(id)` is the card's window element, re-found each frame (the sheet redraws). */
export function sparring(roster: readonly Creature[], windows: (id: string) => HTMLElement | null) {
  const canvas = document.createElement("canvas");
  canvas.className = "spar-layer";
  canvas.setAttribute("aria-hidden", "true");
  document.body.append(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.4); sun.position.set(4, 9, 7);
  scene.add(sun, new THREE.HemisphereLight(0xf2e4c4, 0x3a2a18, 1.1));
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  // a ruled floor, a line a metre: a quick one sends the lines streaming past, a heavy one lets them crawl
  const floor = new THREE.GridHelper(80, 80, 0x6b4a2a, 0x8a6a44);
  for (const mat of [floor.material].flat()) { mat.transparent = true; mat.opacity = 0.55; }
  scene.add(floor);
  const slots: Slot[] = roster.map((c, i) => ({
    c, m: sparMatch(c), p: null, height: c.heightM,
    d: { stat: STATS[i % STATS.length]!, beat: 0, left: DRILLS[STATS[i % STATS.length]!][0]![1] },
    el: () => windows(c.id),
  }));
  for (const s of slots) void loadBeast(s.c.id).then((b) => {
    if (!b) return;
    s.p = new Puppet(b, s.m.f[0].b, s.c.archetype, s.c.fields, FX_AMOUNT[tierOf(s.c.id)]);
    s.p.wearTile(s.c.fields);
    s.height = b.sheet.height;
    scene.add(s.p.group);
  }).catch(() => {});
  let on = false, acc = 0, tick = 0, last = 0, hold: { id: string; stat: Stat } | null = null;
  const size = () => { renderer.setSize(innerWidth, innerHeight, false); };
  function frame(now: number) {
    if (!on) return;
    const dt = Math.min(0.1, (now - (last || now)) / 1000); last = now;
    acc += dt;
    while (acc >= 1 / HZ) { acc -= 1 / HZ; tick++; for (const s of slots) s.m = sparStep(s.m, s.d, hold?.id === s.c.id ? hold.stat : null); }
    if (canvas.width !== Math.round(innerWidth * renderer.getPixelRatio())) size();
    renderer.setScissorTest(false); renderer.clear(); renderer.setScissorTest(true);
    // one framing for all five, by the tallest, so a small one looks small next to a big one
    const tall = Math.max(...slots.map((s) => s.height), 1);
    // a dialog or the Book's own words over the page: the beasts stay under it
    const covered = !!document.querySelector(":popover-open, dialog[open]");
    for (const s of slots) {
      const el = covered ? null : s.el(), r = el?.getBoundingClientRect();
      if (s.p) s.p.group.visible = false;
      if (!s.p || !r || r.width < 8 || r.bottom < 0 || r.top > innerHeight) continue;
      const f = s.m.f[0];
      s.p.group.visible = true;
      for (const o of slots) if (o !== s && o.p) o.p.group.visible = false;
      camera.aspect = r.width / r.height;
      // the window follows it along the floor, at one distance for all five
      camera.position.set(f.pos.x, tall * 0.55 + 0.25, tall * 1.7 + 1.4);
      camera.lookAt(f.pos.x, tall * 0.4, 0);
      camera.updateProjectionMatrix();
      s.p.update(f, dt, tick, { x: f.pos.x + 30, y: 1, z: 0 });
      const y = innerHeight - r.bottom;
      renderer.setViewport(r.left, y, r.width, r.height);
      renderer.setScissor(r.left, y, r.width, r.height);
      renderer.render(scene, camera);
      const cap = el!.parentElement?.querySelector<HTMLElement>(".spar-says");
      if (cap && cap.dataset.stat !== s.d.stat) { cap.dataset.stat = s.d.stat; cap.textContent = MEANS[s.d.stat]; }
    }
    requestAnimationFrame(frame);
  }
  return {
    /** Start (or stop) the five; stopping clears the layer. */
    show(yes: boolean) {
      if (yes === on) return;
      on = yes; canvas.hidden = !yes; last = 0;
      if (yes) { size(); requestAnimationFrame(frame); }
    },
    /** Keep beast `id` on `stat`'s drill (a pointer on its word), or let it go on round its drills (null). */
    hold(id: string | null, stat: Stat | null) { hold = id && stat ? { id, stat } : null; },
    /** For the probe and the test: each beast's drill now and where it stands. */
    state: () => slots.map((s) => ({ id: s.c.id, stat: s.d.stat, x: +s.m.f[0].pos.x.toFixed(2), state: s.m.f[0].state, loaded: !!s.p, ticks: s.m.tick })),
  };
}
