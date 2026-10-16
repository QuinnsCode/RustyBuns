import { expect, test } from "bun:test";
import { ALL, OLD, Sim, type Layers } from "../src/swarm-sim.ts";
import { at, SCENES, startOf, total } from "../src/swarm-story.ts";

const crowd = { agents: 30, overlap: 0.35, flaky: 0.12 };
const run = (layers: Layers, knobs = crowd, minutes = 480) => { const s = new Sim(layers, { ...knobs }, 5); s.step(minutes); return s; };

test("each layer takes down the wall the story says it does", () => {
  const old = run(OLD), coord = run({ coord: true, mervin: false, ester: false }), mervin = run({ coord: true, mervin: true, ester: false }), all = run(ALL);
  // one lane: more agents don't help
  expect(run(OLD, { ...crowd, agents: 90 }).perHour()).toBeLessThan(old.perHour() * 2);
  // a wide lane lands more, but conflicts climb with it
  expect(coord.stats.landed).toBeGreaterThan(old.stats.landed * 1.5);
  expect(coord.stats.bounces.merge).toBeGreaterThan(old.stats.bounces.merge);
  // Mervin: nobody goes back to rebase; a few cards wait on the bench instead
  expect(mervin.stats.bounces.merge).toBe(0);
  expect(mervin.stats.settled).toBeGreaterThan(mervin.stats.cards);
  // Ester: the stations stop being the cap, and fewer reds go back to an agent
  expect(all.stats.landed).toBeGreaterThan(mervin.stats.landed);
  expect(all.stats.reruns).toBeGreaterThan(0);
  expect(all.stats.wasted).toBeLessThan(old.stats.wasted / 4);
});

test("one agent with no overlap and no red checks never bounces", () => {
  const s = run(OLD, { agents: 1, overlap: 0, flaky: 0 });
  expect(s.stats.bounces).toEqual({ merge: 0, test: 0 });
  expect(s.stats.landed).toBeGreaterThan(5);
});

test("the same seed plays the same run", () => {
  expect(run(ALL).stats).toEqual(run(ALL).stats);
});

test("fewer agents mid-run, and Mervin switched off with PRs seated, loses nobody in a stage", () => {
  const s = new Sim({ ...ALL }, { ...crowd }, 9);
  s.step(90);
  s.setAgents(10);
  s.setLayers({ coord: true, mervin: false, ester: true });
  s.step(120);
  expect(s.dots.length).toBe(10);
  expect(s.dots.filter((d) => d.stage === "platform" || d.stage === "train" || d.stage === "bench")).toEqual([]);
  // every dot that waits is in the one list for its stage
  for (const d of s.dots) {
    if (d.stage === "queue") expect(s.queue).toContain(d.id);
    if (d.stage === "testq") expect(s.testq).toContain(d.id);
  }
});

test("the story loops, its faders glide from the last scene's, and a scene can be jumped to", () => {
  expect(at(0).scene.id).toBe(SCENES[0]!.id);
  const crowdStart = startOf("crowd");
  expect(at(crowdStart).knobs.agents).toBe(SCENES[0]!.knobs.agents);
  expect(at(crowdStart + SCENES[1]!.ms - 1).knobs.agents).toBe(SCENES[1]!.knobs.agents);
  expect(at(total() + crowdStart + 1).scene.id).toBe("crowd");
  expect(SCENES.filter((s) => s.wipe).map((s) => s.id)).toEqual(["calm", "coord", "mervin", "ester", "both"]);
});
