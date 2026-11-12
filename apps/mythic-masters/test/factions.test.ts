import { describe, expect, test } from "bun:test";
import { bind, clearSection, loadJourney, newJourney, SECTIONS, type Journey } from "../src/journey.ts";
import { behind, problems, weaveProblems } from "../src/factions/check.ts";
import { approach, aside, back, deed, factionsOf, FACTION, fought, hail, holds, meet, nextStage, pick, postFought, postsIn, postTeam, record, reply, REMATCH_MS, AWAY_MS, sectionCleared, standingOf, waiting, type Ctx } from "../src/factions/engine.ts";
import { FACTIONS, type When } from "../src/factions/model.ts";
import { bandOf, deal, fresh, lag, pressure, reading, together, trendOf } from "../src/factions/read.ts";
import { lint } from "../src/factions/ste.ts";
import { jumpTo } from "../src/factions/jump.ts";
import { ledgerOf } from "../src/factions/ledger.ts";

const HOUR = 3_600_000, T0 = 1_800_000_000_000;
const start = () => newJourney(["squonk", "hodag", "jackalope"], T0)!;
/** Clears sections 0 to `upTo` of region n, an hour apart from `from`; what you noticed behind you on the way. */
function walk(j: Journey, n: number, upTo: number, from = T0): string[] {
  const told: string[] = [];
  for (let k = 0; k <= upTo; k++) if ((j.cleared[n] ?? 0) <= k) { clearSection(j, n, k); told.push(...sectionCleared(j, n, k, from + k * HOUR)); }
  return told;
}
const at = (n: number, k: number, now = T0 + 100 * HOUR): Ctx => ({ now, n, k });

describe("the three factions behind you", () => {
  test("every faction's words and the weave fit the plan", async () => {
    for (const id of FACTIONS) expect({ id, problems: problems(id, await Bun.file(new URL(`../content/faction-${id}.json`, import.meta.url)).json()) }).toEqual({ id, problems: [] });
    expect(weaveProblems(await Bun.file(new URL("../content/faction-weave.json", import.meta.url)).json())).toEqual([]);
    // a writer's slip is caught: a long sentence, a contraction, a key the conditions do not have
    expect(lint("Do not move.")).toEqual([]);
    expect(lint("Don't move.").length).toBe(1);
    expect(lint("This sentence goes on and on and on for far too many words to be one instruction in a manual that people must follow.").length).toBe(1);
    const office: unknown = await Bun.file(new URL("../content/faction-office.json", import.meta.url)).json();
    const slip: unknown = JSON.parse(JSON.stringify(office).replace('"when":{', '"when":{"whenever":true,'));
    expect(problems("office", slip).some((p) => p.includes('"whenever" is not a condition'))).toBe(true);
  });

  test("the Office's first step: it opens behind you, they count you, your answer is kept, and the fight closes it", () => {
    const j = start(), stage = FACTION.office.quest[0]!;
    // nothing waits until you are past its section; clearing that section gives them away behind you
    expect(walk(j, 1, stage.k - 1)).toEqual([]);
    expect(waiting(j, "office", at(1, stage.k))).toBeUndefined();
    expect(FACTION.office.tells).toContain(walk(j, 1, stage.k)[0]!);
    const scene = approach(j, "office", at(1, stage.k + 1))!;
    expect([scene.stage.id, scene.who.id, scene.replies.map((r) => r.style).sort()]).toEqual(["office.1", stage.who, ["dry", "hard", "straight"]]);
    expect(scene.hail.length).toBeGreaterThan(0);
    // met first, and counted as you were: five section pages, no fires, three kinds in the Book
    expect(factionsOf(j).met).toEqual(["office"]);
    expect(standingOf(j, "office").intro).toMatchObject({ n: 1, k: stage.k, pages: stage.k + 1, fires: 0, binds: 3, party: 1 });
    // the dry answer gives them Gary's name; it is remembered as how you talk to this person
    const dry = stage.replies.find((r) => r.style === "dry")!, got = reply(j, scene, dry.id, at(1, stage.k + 1))!;
    expect(got.said.length).toBeGreaterThan(0);
    expect(factionsOf(j).flags).toContain("office-gary");
    expect(standingOf(j, "office").people[stage.who]).toMatchObject({ talks: 1, last: "dry" });
    expect(reply(j, scene, dry.id, at(1, stage.k + 1))).toBeNull(); // answered once
    // a reply that starts the fight leaves the step pending: lose, and they wait; come back, and it is a rematch; win, and it is done
    const k = start(); walk(k, 1, stage.k);
    const sc = approach(k, "office", at(1, stage.k))!, hard = stage.replies.find((r) => r.fight)!;
    const team = reply(k, sc, hard.id, at(1, stage.k))!.team!;
    expect(team.length).toBeGreaterThan(0);
    for (const f of team) expect(behind(1).has(f.id)).toBe(true);
    expect(fought(k, "office", "office.1", false, at(1, stage.k)).length).toBeGreaterThan(0);
    expect(factionsOf(k).done).toEqual([]);
    const again = approach(k, "office", at(1, stage.k))!;
    expect([again.ask, again.replies.length, again.team!.length]).toEqual([null, 0, team.length]);
    fought(k, "office", "office.1", true, at(1, stage.k));
    expect(factionsOf(k).done).toEqual(["office.1"]);
    expect(nextStage(k, "office")?.id).toBe("office.2");
    expect(record(k).map((r) => r.id)).toEqual(["office.1"]);
    // the save keeps all of it
    expect(loadJourney(JSON.stringify(k))?.factions).toEqual(factionsOf(k));
  });

  test("a line's when reads the small things: before the intro, the gap, your manner, the order, the reading", () => {
    const j = start();
    walk(j, 1, 5);
    j.fires.push("a", "b", "c");
    meet(j, "office", at(1, 4, T0 + 10 * HOUR)); // they count you here: six pages, three fires
    walk(j, 1, 8, T0 + 20 * HOUR);
    const st = standingOf(j, "office"), fs = factionsOf(j), now = T0 + 200 * HOUR;
    st.people.pell = { at: now - 2 * HOUR, talks: 3, styles: [0, 2, 1], last: "hard" };
    fs.done.push("lamplighters.2", "office.2");
    fs.flags.push("message-run");
    for (const d of [-2, -2, -2]) deal(st, d);
    const cases: [string, When, boolean][] = [
      ["a page you had before they met you", { before: ["1:5"] }, true],
      ["a page you wrote after", { before: ["1:8"] }, false],
      ["and its opposite", { notBefore: ["1:8"] }, true],
      ["fires lit by the intro", { had: { fires: 3 } }, true],
      ["more than you had lit", { had: { fires: 4 } }, false],
      ["fewer than", { hadUnder: { fires: 4 } }, true],
      ["as things stand now", { have: { regions: 0 }, haveUnder: { regions: 1 } }, true],
      ["two hours since you spoke to Pell", { gap: ["later"] }, true],
      ["not a day", { gap: ["long"] }, false],
      ["you mostly joke with Pell", { manner: "dry" }, true],
      ["but your last answer was hard", { last: "hard" }, true],
      ["stages in the order you did them", { inOrder: ["lamplighters.2", "office.2"] }, true],
      ["not the other way round", { inOrder: ["office.2", "lamplighters.2"] }, false],
      ["the faction you met first", { first: "office", unmet: ["institute"] }, true],
      ["a flag and a creature", { flags: ["message-run"], owns: ["squonk"], lacks: ["sasquatch"], starter: "squonk" }, true],
      ["three hard answers: cold now, cold on the whole, falling", { now: ["cold"], past: ["cold", "cool"], trend: ["falling"] }, true],
      ["alone, by day", { party: false, night: false }, true],
    ];
    for (const [name, when, want] of cases) expect({ name, holds: holds(when, j, "office", "pell", at(1, 8, now)) }).toEqual({ name, holds: want });
    // someone you never spoke to: the gap is "first" and there is no manner yet
    expect(holds({ gap: ["first"] }, j, "office", "quist", at(1, 8, now))).toBe(true);
    expect(holds({ manner: "dry" }, j, "office", "quist", at(1, 8, now))).toBe(false);
    // the line that asks the most, and holds, is the one said
    const lines = [{ text: "plain" }, { text: "one", when: { gap: ["later"] } as When }, { text: "two", when: { gap: ["later"], manner: "dry" } as When }, { text: "never", when: { gap: ["long"], manner: "dry", last: "hard" } as When }];
    expect(pick(lines, j, "office", "pell", at(1, 8, now))?.text).toBe("two");
    expect(pick(lines, j, "office", "quist", at(1, 8, now))?.text).toBe("plain");
  });

  test("the reading: where you stand, where you have stood, which way it is going, and the pressure that makes", () => {
    const st = fresh();
    expect(reading(st)).toEqual({ now: 0, past: 0, trend: 0 });
    for (const d of [-2, -2, -2, -2]) deal(st, d); // standings -2, -4, -6, -8
    expect(reading(st)).toEqual({ now: -8, past: -5, trend: -6 });
    expect([bandOf(-8), bandOf(-5), trendOf(-6), pressure(reading(st))]).toEqual(["cold", "cold", "falling", 4]);
    // three good dealings: still a cold past, but rising, and the pressure eases before the standing recovers
    for (const d of [2, 2, 2]) deal(st, d); // -6, -4, -2
    const r = reading(st);
    expect([r.now, bandOf(r.past), trendOf(r.trend)]).toEqual([-2, "cold", "rising"]);
    expect(pressure(r)).toBeLessThan(4);
    // a friend's teams stand under their section
    const friend = fresh();
    for (let i = 0; i < 6; i++) deal(friend, 2);
    expect(pressure(reading(friend))).toBe(-2);
    // a party is read by its worst member now, and the mean of the rest
    expect(together([reading(st), reading(friend)])).toEqual({ now: -2, past: (r.past + reading(friend).past) / 2, trend: (r.trend + reading(friend).trend) / 2 });
    // an old enemy who is mending hears about it, once, from the faction itself
    const j = start();
    meet(j, "lamplighters", at(1, 2));
    Object.assign(standingOf(j, "lamplighters"), { s: st.s, area: st.area, deals: st.deals, recent: st.recent });
    expect(aside(j, "lamplighters", "wren", at(1, 2))).toContain("We watch the lately");
    expect(aside(j, "lamplighters", "wren", at(1, 2))).toBeNull();
  });

  test("the weave: a promise broken is known, one made too late is not held against you, and deeds are echoed once each", () => {
    const promise = (holding: boolean) => {
      const j = start(), l = FACTION.lamplighters, stage = l.quest[3]!;
      if (holding) bind(j, "sasquatch", 20);
      meet(j, "lamplighters", at(1, 2));
      for (const s of l.quest.slice(0, 3)) factionsOf(j).done.push(s.id);
      for (let k = 0; k <= stage.k; k++) clearSection(j, 4, k);
      const scene = approach(j, "lamplighters", at(4, stage.k))!;
      reply(j, scene, stage.replies.find((r) => (r.sets ?? []).includes("ridge-promise"))!.id, at(4, stage.k));
      if (!holding) bind(j, "sasquatch", 40);
      const before = standingOf(j, "lamplighters").s, said: string[] = [];
      for (let i = 0; i < 12; i++) { const a = aside(j, "lamplighters", "wren", at(4, 9)); if (a) said.push(a); }
      return { said, dropped: before - standingOf(j, "lamplighters").s, flags: factionsOf(j).flags };
    };
    const broke = promise(false), late = promise(true);
    expect(broke.said.some((s) => s.includes("The Book holds the giant now"))).toBe(true);
    expect(broke.flags).toContain("ridge-broken");
    expect(late.flags).toContain("ridge-promise-late");
    expect(late.said.some((s) => s.includes("The Book holds the giant now"))).toBe(false);
    expect(late.flags).not.toContain("ridge-broken");

    // a deed is echoed by each faction you have met, once; the same deed done again is said again
    const j = start();
    meet(j, "office", at(1, 4)); meet(j, "institute", at(1, 8));
    deed(j, "mythic-bound");
    const first = aside(j, "office", "pell", at(1, 11));
    expect(first).toBeTruthy();
    expect(aside(j, "office", "pell", at(1, 11))).toBeNull();
    expect(aside(j, "institute", "vale", at(1, 11))).toBeTruthy();
    deed(j, "mythic-bound");
    expect(aside(j, "office", "pell", at(2, 11))).toBeTruthy();
    // three days away is a deed of its own
    back(j, T0); back(j, T0 + AWAY_MS - 1);
    expect(factionsOf(j).flags).not.toContain("long-away");
    back(j, T0 + 2 * AWAY_MS);
    expect(factionsOf(j).flags).toContain("long-away");
  });

  test("posts: manned behind you by the factions you have met, a team of what is behind you, and another go tomorrow", () => {
    const j = start(), ctx = at(1, 11);
    for (let k = 0; k < SECTIONS; k++) clearSection(j, 1, k);
    expect(postsIn(j, 1, ctx)).toEqual([]); // nobody you have not met
    meet(j, "office", at(1, 4));
    const posts = postsIn(j, 1, ctx);
    expect(posts.map((p) => p.post.k).sort((a, b) => a - b)).toEqual([0, 6, 9]);
    const m = posts[0]!, h = hail(j, m, ctx), team = h.team!;
    expect(h.line.length * h.hail.length).toBeGreaterThan(0);
    expect(team.length).toBeGreaterThan(0);
    for (const f of team) expect({ id: f.id, behind: behind(1).has(f.id), named: /^Asset \d+$/.test(f.title ?? "") }).toEqual({ id: f.id, behind: true, named: true });
    expect(postTeam(j, m)).toEqual(team); // the same team every time
    // beaten, it rests; a day later it is back, and no more than a level under your lead
    expect(postFought(j, m, true, ctx).length).toBeGreaterThan(0);
    expect(postsIn(j, 1, ctx).find((p) => p.id === m.id)?.resting).toBe(true);
    expect(hail(j, postsIn(j, 1, ctx).find((p) => p.id === m.id)!, ctx).team).toBeNull();
    j.party[0]!.level = 30;
    const later = { ...ctx, now: ctx.now + REMATCH_MS }, back2 = postsIn(j, 1, later).find((p) => p.id === m.id)!;
    expect(back2.resting).toBe(false);
    expect(Math.min(...postTeam(j, back2).map((f) => f.level))).toBeGreaterThanOrEqual(29);

    // on a trail you are still walking they are behind you: one section at a walk, two when you move fast, none once you stop for a day
    const k = start();
    meet(k, "office", at(1, 4));
    walk(k, 1, 6, T0); // sections an hour apart; you stand in section 7
    const reach = (now: number) => postsIn(k, 1, { now, n: 1, k: 7 }).map((p) => p.post.k).sort((a, b) => a - b);
    expect([lag(k, T0 + 6 * HOUR + 1), reach(T0 + 6 * HOUR + 1)]).toEqual([1, [0, 6]]);
    const fast = start();
    meet(fast, "office", at(1, 4));
    for (let s = 0; s <= 9; s++) { clearSection(fast, 1, s); sectionCleared(fast, 1, s, T0 + s * 60_000); }
    expect([lag(fast, T0 + 10 * 60_000), postsIn(fast, 1, { now: T0 + 10 * 60_000, n: 1, k: 10 }).map((p) => p.post.k).sort((a, b) => a - b)]).toEqual([2, [0, 6]]);
    expect(lag(fast, T0 + 30 * HOUR)).toBe(0);
    expect(postsIn(fast, 1, { now: T0 + 30 * HOUR, n: 1, k: 10 }).map((p) => p.post.k).sort((a, b) => a - b)).toEqual([0, 6, 9]);
  });

  test("a jump link lands at its step, and the Compendium's Factions page tells the quest so far", () => {
    // every step of all three quests opens where it should, the steps before it played through the real engine
    for (const f of FACTIONS) for (const st of FACTION[f].quest) {
      const j = jumpTo(st.id, T0)!;
      expect({ step: st.id, waits: waiting(j, f, { now: T0, n: st.n, k: st.k + 1 })?.id }).toEqual({ step: st.id, waits: st.id });
    }
    expect(jumpTo("office.9", T0)).toBeNull();
    // four of the Office's steps done: the page lists them in order with their lines, and where No Cars waits
    const j = jumpTo("office.5", T0)!, [office, ...rest] = ledgerOf(j);
    expect(rest).toEqual([]);
    expect([office!.name, office!.calls, office!.done.map((d) => d.id), office!.next?.title]).toEqual([FACTION.office.name, "Subject", ["office.1", "office.2", "office.3", "office.4"], "No Cars"]);
    expect(office!.done[0]!.log).toBe(FACTION.office.quest[0]!.log);
    expect(office!.next!.where).toContain("Mackinac Island");
    expect(office!.standing).toMatch(/^(Cold|Cool|Even|Warm|Close) to you now, \w+ on the whole, and (falling|steady|rising)\.$/);
    // the last step won, the quest is closed; nothing met yet, the page is empty
    const end = jumpTo("lamplighters.8", T0)!, ctx = at(8, FACTION.lamplighters.quest[7]!.k + 1);
    const sc = approach(end, "lamplighters", ctx)!, got = reply(end, sc, sc.replies[0]!.id, ctx)!;
    if (got.team) fought(end, "lamplighters", "lamplighters.8", true, ctx);
    expect(ledgerOf(end)[0]!.next).toBeNull();
    expect(ledgerOf(start())).toEqual([]);
  });
});
