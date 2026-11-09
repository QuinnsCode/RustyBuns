import { describe, expect, setDefaultTimeout, test } from "bun:test";

// Each level is mapped and a raid is played out on the defend ones: slow on CI.
setDefaultTimeout(60_000);
import { LEVELS } from "../src/levels/levels.ts";
import { CAMPAIGN, chapterOf, nextChapter, opened } from "../src/sim/campaign.ts";
import { gateDir, mapRepo, reachable } from "../src/sim/codemap.ts";
import { Game, SLIDE, type Input } from "../src/sim/game.ts";
import { missionFor, OVERRUN } from "../src/sim/missions.ts";
import { CLIPS, rollClip, SLOW, stageClip, type ClipId } from "../src/sim/credits.ts";

const idle: Input = { right: 0, forward: 0, yaw: 0, pitch: 0, jump: false, roll: false, crouch: false, fire: false };

describe("campaign", () => {
  test("a climb through every level, each chapter opening on a win of the one before", () => {
    expect(CAMPAIGN.map((c) => c.level).sort()).toEqual(LEVELS.map((l) => l.id).sort());
    expect(CAMPAIGN[0]!.level).toBe("kitchen");
    expect(CAMPAIGN.at(-1)!.level).toBe("front-room");
    expect(opened([])).toBe(1);
    expect(opened(["kitchen:rustybuns"])).toBe(2);
    // A win further up doesn't skip the chapters below it.
    expect(opened(["kitchen:x", "garden:x"])).toBe(2);
    expect(opened(CAMPAIGN.map((c) => `${c.level}:x`))).toBe(CAMPAIGN.length);
    expect(nextChapter("kitchen")!.level).toBe("backyard");
    expect(nextChapter("glacier-point")!.title).toBe("Topple the empire");
    expect(nextChapter("front-room")).toBeNull();
    expect(chapterOf("place:1,2")).toBe(-1);
  });

  // Real ground, Half Dome and Glacier Point most, puts yards on ledges: the gate must never open onto the drop.
  test.each(LEVELS.map((l) => [l.id, l] as const))("%s: every gate opens onto ground you can walk out on, and HEAD can walk to it", (_, l) => {
    const m = mapRepo(l.ground(), l.repo, l.seed), canReach = reachable(m.terrain, m.spawn.x, m.spawn.z, 1, SLIDE);
    for (const c of m.compounds) {
      const g = gateDir(c.gate!), at = (s: number) => m.terrain.height(c.x + g.x * (c.half! + s), c.z + g.z * (c.half! + s));
      for (let s = 0; s < 12; s++) expect(Math.abs(at(s + 1) - at(s)), `${l.id}: ${c.folder}, ${s} m out of the gate`).toBeLessThan(SLIDE);
      expect(canReach(c.x + g.x * (c.half! + 1.5), c.z + g.z * (c.half! + 1.5)), `${l.id}: ${c.folder}`).toBe(true);
    }
  });

  test.each(LEVELS.filter((l) => missionFor(l.id).kind === "defend").map((l) => [l.id, l] as const))("%s: raiders come down their footpath to main, and stand on it if nobody stops them", (_, l) => {
    const g = Game.fromRepo(l.ground(), l.repo, l.seed, missionFor(l.id)), you = g.you();
    for (let t = 0; t < 90 && g.status === "playing"; t += 1 / 30) {
      you.hp = you.maxHp, you.shield = you.maxShield;
      g.step(1 / 30, idle);
    }
    expect(g.status).toBe("lost");
    expect(g.objective.kind === "defend" && g.objective.overrun).toBeGreaterThanOrEqual(OVERRUN);
  });
});

describe("the newsreel", () => {
  // The footage is the engine's, on the last chapter's level: each clip does on screen what its slogan says.
  test("over the top goes up onto a file and down the far side; the drop is still under its canopy", () => {
    const def = LEVELS.find((l) => l.id === CAMPAIGN.at(-1)!.level)!, g = Game.fromRepo(def.ground(), def.repo, def.seed, missionFor(def.id));
    const take = (id: ClipId) => {
      const c = CLIPS.find((k) => k.id === id)!, clip = stageClip(g, id), you = g.you(), from = { x: you.x, y: you.y };
      let done = 0, top = -Infinity;
      while (done < (c.to - c.from) * SLOW - 1e-6) done = rollClip(g, clip, done, done + 1 / 30), top = Math.max(top, you.y - from.y);
      return { top, ran: you.x - from.x, chute: you.chute, alive: you.alive };
    };
    const over = take("over");
    expect(over.top).toBeGreaterThan(1);
    expect(over.ran).toBeGreaterThan(5);
    expect(over.alive).toBe(true);
    expect(take("drop")).toMatchObject({ chute: true, alive: true });
  });
});
