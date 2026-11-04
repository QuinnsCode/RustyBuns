// The swarm story (swarm.html, and the landing page's copy of it): scenes over the simulation in swarm-sim.ts, from
// old git with a few people, through agents and then swarms, to codeSplitter's layers one at a time. A scene says which
// layers are on, where the faders go (they glide there while it plays), what to point at, and its caption. The stage
// waits on Next at a scene's end unless it plays on its own. `wipe` starts a fresh simulation behind a wipe, warmed up
// so the crowd is already there. No DOM; swarm-stage.js plays it.
import type { Knobs, Layers } from "./swarm-sim.ts";

/** A part of the stage a scene points at. */
export type Focus = "desks" | "lane" | "wall" | "train" | "tests" | "home";

export interface Scene {
  id: string;
  title: string;
  caption: string;
  layers: Layers | "split";
  /** Where the faders end up by the scene's end (they start where the last scene left them). */
  knobs: Knobs;
  /** Simulated minutes per real second. */
  speed: number;
  /** Real milliseconds at 1x playback. */
  ms: number;
  focus?: Focus;
  /** A fresh simulation behind a wipe, run `warm` minutes first. */
  wipe?: boolean;
  warm?: number;
}

const OLD: Layers = { coord: false, mervin: false, ester: false };
const COORD: Layers = { coord: true, mervin: false, ester: false };
const MERVIN: Layers = { coord: true, mervin: true, ester: false };
const ALL: Layers = { coord: true, mervin: true, ester: true };
const CROWD: Knobs = { agents: 30, overlap: 0.35, flaky: 0.12 };

export const SCENES: Scene[] = [
  { id: "calm", title: "First we were talking with one agent at a time.", layers: OLD, knobs: { agents: 4, overlap: 0.15, flaky: 0.04 }, speed: 1, ms: 9000, focus: "lane", wipe: true, warm: 60,
    caption: "A few changes a day walk down the stairs, through the gate and onto the train to main." },
  { id: "agents", title: "Then more agents showed up.", layers: OLD, knobs: { agents: 8, overlap: 0.2, flaky: 0.06 }, speed: 1, ms: 10000, focus: "desks",
    caption: "More people on the stairs. The gate still keeps up." },
  { id: "notice", title: "Then it got crowded.", layers: OLD, knobs: { agents: 14, overlap: 0.25, flaky: 0.08 }, speed: 1, ms: 11000, focus: "lane",
    caption: "Now and then someone gets sent back up to fix a clash." },
  { id: "swarm", title: "Now we swarm agents on a task.", layers: OLD, knobs: CROWD, speed: 1, ms: 11000, focus: "desks",
    caption: "Thirty agents start from the same code and finish at the same time." },
  { id: "smart", title: "And they're fast.", layers: OLD, knobs: { ...CROWD, overlap: 0.4 }, speed: 1, ms: 11000, focus: "lane",
    caption: "They all reach the stairs at once." },
  { id: "merge-wall", title: "Merge gets clogged.", layers: OLD, knobs: CROWD, speed: 1, ms: 10000, focus: "wall",
    caption: "Five agents touch the same README line. Git sends four of them back up." },
  { id: "test-wall", title: "Testing and CI get clogged.", layers: OLD, knobs: CROWD, speed: 1, ms: 10000, focus: "tests",
    caption: "A test fails, nobody knows whose fault it is, so back up the stairs." },
  { id: "stuck", title: "Everyone's stuck.", layers: OLD, knobs: { ...CROWD, agents: 45 }, speed: 1.5, ms: 8000,
    caption: "The agents aren't short on brains. They're short on a way in." },
  { id: "coord", title: "So we widened the stairs.", layers: COORD, knobs: CROWD, speed: 1, ms: 11000, focus: "lane", wipe: true, warm: 45,
    caption: "The code lives on a Durable Object every agent talks to live, with git in Artifacts behind it." },
  { id: "toe-step", title: "They still bump at the gate.", layers: COORD, knobs: CROWD, speed: 1, ms: 10000, focus: "wall",
    caption: "Agents working at once still clash on the same lines." },
  { id: "mervin", title: "Mervin fixes the merges.", layers: MERVIN, knobs: CROWD, speed: 1, ms: 11000, focus: "train", wipe: true, warm: 45,
    caption: "A plain program, not an AI: it fixes most clashes on the spot and loads four trains at once." },
  { id: "what-conflicts", title: "Merge conflicts mostly vanish.", layers: MERVIN, knobs: CROWD, speed: 1, ms: 9000, focus: "train",
    caption: "Only the few that need a person wait on the bench." },
  { id: "stations", title: "Now the exit is clogged.", layers: MERVIN, knobs: { ...CROWD, agents: 45 }, speed: 1, ms: 9000, focus: "tests",
    caption: "Four trains arrive, and the tests still take one person at a time." },
  { id: "ester", title: "Ester clears the tests.", layers: ALL, knobs: { ...CROWD, agents: 45 }, speed: 1, ms: 11000, focus: "tests", wipe: true, warm: 45,
    caption: "She tests many PRs in one run, reruns a flaky test, and only sends back a real failure." },
  { id: "both", title: "Same agents, same hour.", layers: "split", knobs: { ...CROWD, agents: 45 }, speed: 1.5, ms: 16000, focus: "home", wipe: true, warm: 30,
    caption: "Top: old git. Bottom: codeSplitter. Count who got home." },
];

export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);

/** Where the story is `ms` real milliseconds in (looping): the scene, how far through it, and where the faders are. */
export function at(ms: number, scenes = SCENES) {
  const total = scenes.reduce((s, x) => s + x.ms, 0);
  let left = ((ms % total) + total) % total;
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i]!;
    if (left < s.ms) {
      const from = i ? scenes[i - 1]!.knobs : s.knobs, k = ease(Math.min(1, left / (s.ms * 0.6)));
      const knobs: Knobs = { agents: Math.round(lerp(from.agents, s.knobs.agents, k)), overlap: lerp(from.overlap, s.knobs.overlap, k), flaky: lerp(from.flaky, s.knobs.flaky, k) };
      return { i, scene: s, progress: left / s.ms, knobs };
    }
    left -= s.ms;
  }
  return { i: 0, scene: scenes[0]!, progress: 0, knobs: scenes[0]!.knobs };
}

/** The real millisecond a scene starts at. */
export const startOf = (id: string, scenes = SCENES) => {
  let ms = 0;
  for (const s of scenes) { if (s.id === id) return ms; ms += s.ms; }
  return 0;
};
export const total = (scenes = SCENES) => scenes.reduce((s, x) => s + x.ms, 0);
