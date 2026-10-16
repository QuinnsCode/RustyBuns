// The swarm story (swarm.html, and the landing page's copy of it): scenes over the simulation in swarm-sim.ts, from the
// old git way to codeSplitter's layers one at a time. A scene says which layers are on, where the faders go (they glide
// there while it plays), what to point at, and its caption. `wipe` starts a fresh simulation behind a wipe, warmed up
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
const CROWD: Knobs = { agents: 60, overlap: 0.5, flaky: 0.14 };

export const SCENES: Scene[] = [
  { id: "calm", title: "The old git way", layers: OLD, knobs: { agents: 4, overlap: 0.2, flaky: 0.06 }, speed: 6, ms: 8000, focus: "lane", wipe: true, warm: 40,
    caption: "A few people, a few changes a day. One lane into main, and everyone takes a turn. It works." },
  { id: "crowd", title: "Now kick off sixty agents", layers: OLD, knobs: CROWD, speed: 6, ms: 10000, focus: "desks",
    caption: "Each one pulled main when it started. By the time it's done, main has moved on without it." },
  { id: "merge-wall", title: "Wall one: merge conflicts", layers: OLD, knobs: CROWD, speed: 6, ms: 10000, focus: "wall",
    caption: "Five agents each add their feature to the README. Git calls that a conflict: back to the desk, rebase, burn tokens, get in line again." },
  { id: "test-wall", title: "Wall two, the quiet one: red checks", layers: OLD, knobs: CROWD, speed: 6, ms: 10000, focus: "tests",
    caption: "Make it past the merge and a check goes red. Yours? Already red on main? Flaky? Nobody can tell, so back to the desk again." },
  { id: "stuck", title: "Everyone's stuck", layers: OLD, knobs: { ...CROWD, agents: 90 }, speed: 8, ms: 8000,
    caption: "More agents, same lane. They aren't short on intelligence. They're short on a way in." },
  { id: "coord", title: "Layer one: a computer on the internet", layers: COORD, knobs: CROWD, speed: 6, ms: 11000, focus: "lane", wipe: true, warm: 45,
    caption: "codeSplitter puts the repo on a Durable Object: a small computer on Cloudflare's network that every agent talks to live, with git in Artifacts behind it. The lane gets wide." },
  { id: "toe-step", title: "But they still pulled a stale tree", layers: COORD, knobs: CROWD, speed: 6, ms: 10000, focus: "wall",
    caption: "Coordination is smooth now. Conflicts aren't: agents building features in parallel still toe-step on the README, just faster." },
  { id: "mervin", title: "Layer two: Mervin fills the train", layers: MERVIN, knobs: CROWD, speed: 6, ms: 11000, focus: "train", wipe: true, warm: 45,
    caption: "Mervin is the attendant filling seats on the bullet train: who can go now, who goes easiest, who waits on a call. Your agents keep their know-how for features." },
  { id: "what-conflicts", title: "Merge conflicts? What are those?", layers: MERVIN, knobs: CROWD, speed: 6, ms: 9000, focus: "train",
    caption: "Line ids settle most of them, so those PRs board too. The few real judgment calls wait on the bench as a card." },
  { id: "stations", title: "Then the stations back up", layers: MERVIN, knobs: { ...CROWD, agents: 90 }, speed: 6, ms: 9000, focus: "tests",
    caption: "Trains arrive faster than the checks can take them, one PR per run, and every red still sends someone home to guess." },
  { id: "ester", title: "Layer three: Ester stacks the stations", layers: ALL, knobs: { ...CROWD, agents: 90 }, speed: 6, ms: 11000, focus: "tests", wipe: true, warm: 45,
    caption: "Ester packs each train into the stations like the best bagger at the grocery store: a car of PRs per test run. Flaky checks rerun quietly. Only your own red comes back to you." },
  { id: "both", title: "Same agents, same hour", layers: "split", knobs: { ...CROWD, agents: 90 }, speed: 8, ms: 16000, focus: "home", wipe: true, warm: 30,
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
