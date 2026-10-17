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
  { id: "calm", title: "This is what old git was like", layers: OLD, knobs: { agents: 4, overlap: 0.15, flaky: 0.04 }, speed: 1, ms: 9000, focus: "lane", wipe: true, warm: 60,
    caption: "A few people and a few changes a day. They walk down the stairs, through the gate and onto the train to main. Easy." },
  { id: "agents", title: "All right, but now we have agents", layers: OLD, knobs: { agents: 8, overlap: 0.2, flaky: 0.06 }, speed: 1, ms: 10000, focus: "desks",
    caption: "Now everyone has an AI agent or two. More people on the stairs, but the gate keeps up. Once in a while there's a clash." },
  { id: "notice", title: "All riiight, but notice something", layers: OLD, knobs: { agents: 14, overlap: 0.25, flaky: 0.08 }, speed: 1, ms: 11000, focus: "lane",
    caption: "It's getting crowded. Sometimes a person gets sent back up to fix a clash, or a test fails and nobody knows why." },
  { id: "swarm", title: "Now swarms of agents show up", layers: OLD, knobs: CROWD, speed: 1, ms: 11000, focus: "desks",
    caption: "Start thirty at once. They all began from the same copy of the code, so they all finish together, and the code has already changed." },
  { id: "smart", title: "The agents are fast now", layers: OLD, knobs: { ...CROWD, overlap: 0.4 }, speed: 1, ms: 11000, focus: "lane",
    caption: "Rush hour! They finish so fast that they all reach the stairs at the same moment. The stairs, the gate and the platform are all jammed." },
  { id: "merge-wall", title: "Wall one: merge conflicts", layers: OLD, knobs: CROWD, speed: 1, ms: 10000, focus: "wall",
    caption: "Five agents each add a line to the README. Git calls that a conflict and sends them back up the stairs to start over." },
  { id: "test-wall", title: "Wall two: tests that fail", layers: OLD, knobs: CROWD, speed: 1, ms: 10000, focus: "tests",
    caption: "Past the gate, a test fails. Was it your fault, already broken, or just flaky? Nobody can tell, so back up the stairs you go." },
  { id: "stuck", title: "Everyone's stuck", layers: OLD, knobs: { ...CROWD, agents: 45 }, speed: 1.5, ms: 8000,
    caption: "More agents, same one staircase. They're not short on brains. They're short on a way in." },
  { id: "coord", title: "Layer one: a computer on the internet", layers: COORD, knobs: CROWD, speed: 1, ms: 11000, focus: "lane", wipe: true, warm: 45,
    caption: "codeSplitter keeps the code on a Durable Object: a tiny computer on the internet that every agent talks to live (git lives in Artifacts behind it). The stairs get wide." },
  { id: "toe-step", title: "But they still step on each other", layers: COORD, knobs: CROWD, speed: 1, ms: 10000, focus: "wall",
    caption: "Everyone gets down the stairs now. But agents working at the same time still bump into each other at the gate, and it jams again." },
  { id: "mervin", title: "Layer two: Mervin and the four trains", layers: MERVIN, knobs: CROWD, speed: 1, ms: 11000, focus: "train", wipe: true, warm: 45,
    caption: "Meet Mervin. He isn't an AI, just a plain program, so he runs as fast as the computer can. He fixes most clashes on the spot and loads four bullet trains at the same time." },
  { id: "what-conflicts", title: "Merge conflicts? What are those?", layers: MERVIN, knobs: CROWD, speed: 1, ms: 9000, focus: "train",
    caption: "Mervin fixes clashes by looking at the exact lines, so most people just get on. The few that need a human decision wait on the bench." },
  { id: "stations", title: "Now the exit is jammed", layers: MERVIN, knobs: { ...CROWD, agents: 45 }, speed: 1, ms: 9000, focus: "tests",
    caption: "Four trains arrive, but there is only one exit, and the tests take one person at a time. Every failed test still sends someone back up." },
  { id: "ester", title: "Layer three: Ester at the exit", layers: ALL, knobs: { ...CROWD, agents: 45 }, speed: 1, ms: 11000, focus: "tests", wipe: true, warm: 45,
    caption: "Meet Ester. She loads each car full, like flight attendants boarding a plane: lots of PRs in one test run. A flaky test just runs again. Only a real failure goes back to you." },
  { id: "both", title: "Same agents, same hour", layers: "split", knobs: { ...CROWD, agents: 45 }, speed: 1.5, ms: 16000, focus: "home", wipe: true, warm: 30,
    caption: "Top: the old git way. Bottom: codeSplitter. Count who got home." },
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
