import { expect, test } from "bun:test";
import { MAX_INPUTS, handIn, newTable, report, waitingOn, type Step, type Table } from "../src/war/table.ts";
import { ORBIT, resolveTurn, type Where } from "../src/war/rules.ts";
import { other, type BattleSpec, type SpaceBattleSpec } from "../src/battle/contract.ts";
import { groundRecorder, spaceRecorder } from "../src/battle/replay.ts";
import { run, startBattle, step } from "../src/battle/sim.ts";
import { runSpace, startSpaceBattle, stepSpace } from "../src/battle/space.ts";

const ok = (s: Step): Extract<Step, { ok: true }> => {
  if (!s.ok) throw new Error(s.error);
  // Once attacks are declared, every human with a say holds their ground, and after the fighting,
  // every human who took somewhere stays put.
  const asked = waitingOn(s.table).filter(() => s.table.campaign.attacks || s.table.campaign.deploying);
  return asked.length ? ok(handIn(s.table, asked[0]!, { faction: asked[0]!, orders: [] })) : s;
};
// The page's side of a played battle: ten seconds charging ahead firing, then the AI takes over.
function playGround(spec: BattleSpec) {
  const b = startBattle(spec), rec = groundRecorder();
  for (let i = 0; !b.over; i++) step(b, i < 300 ? rec.take({ forward: 1, right: 0, yaw: spec.hero === "attacker" ? 0 : Math.PI, fire: true }) : null);
  return { ...b.over!, inputs: rec.log() };
}
function playSpace(spec: SpaceBattleSpec) {
  const b = startSpaceBattle(spec), rec = spaceRecorder();
  for (let i = 0; !b.over; i++) stepSpace(b, i < 300 ? rec.take({ yaw: 0.3, pitch: 0.1, throttle: 1, fire: true }) : null);
  return { ...b.over!, inputs: rec.log() };
}
const kept = <T extends { inputs?: string }>({ inputs: _, ...r }: T) => r; // what the history keeps

const empty = (faction: "marines" | "wooka", hero?: Where) => ({ faction, orders: [], ...(hero && { hero }) });

// Kessa's shield generator under a Marine orbit, with a Marine army landing on it: a battle there this turn.
function kessaFight(t: Table) {
  const k = t.campaign.systems.kessa!;
  k.fleets = { marines: 3, wooka: 0 };
  k.orbit = "marines";
  return { faction: "marines" as const, orders: [{ kind: "army" as const, from: { system: "corva", sector: 0 }, to: { system: "kessa", sector: 0 }, count: 2 }] };
}

test("against the AI, the turn resolves the moment the human's orders are in", () => {
  const t = newTable({ marines: "human", wooka: "ai" }, "short", 7);
  expect(waitingOn(t)).toEqual(["marines"]);
  const s = ok(handIn(t, "marines", empty("marines")));
  expect(s.table.campaign.turn).toBe(2);
  expect(s.done).toMatchObject({ turn: 1, battle: null });
  expect(s.done!.orders.map((o) => o.faction)).toEqual(["marines", "wooka"]);
});

test("hotseat: nothing resolves until both sides are in, and the same orders resolve the same way", () => {
  const t = newTable({ marines: "human", wooka: "human" }, "short", 7);
  const build = { faction: "wooka" as const, orders: [{ kind: "build" as const, unit: "army" as const, at: { system: "nyx", sector: 0 } }] };
  const one = ok(handIn(t, "marines", empty("marines")));
  expect(one.done).toBeNull();
  expect(one.table.campaign.turn).toBe(1);
  expect(waitingOn(one.table)).toEqual(["wooka"]);
  expect(handIn(one.table, "marines", empty("marines"))).toEqual({ ok: false, error: "Orders already in for this turn" });
  const two = ok(handIn(one.table, "wooka", build));
  expect(two.table.campaign.turn).toBe(2);
  expect(two.table.handedIn).toEqual({});
  expect(two.table.campaign).toEqual(resolveTurn(t.campaign, [empty("marines"), build]));
});

test("orders the rules refuse, or that aren't orders at all, are turned away", () => {
  const t = newTable({ marines: "human", wooka: "human" }, "short", 7);
  expect(handIn(t, "marines", { faction: "marines", orders: [{ kind: "build", unit: "fleet", at: { system: "nyx", sector: 0 } }] }))
    .toEqual({ ok: false, error: "You don't hold that sector" });
  expect(handIn(t, "marines", empty("wooka"))).toEqual({ ok: false, error: "Those aren't orders" });
  expect(handIn(t, "marines", { faction: "marines", orders: [{ kind: "army", from: null, to: 3, count: 1 }] } as never)).toEqual({ ok: false, error: "Those aren't orders" });
  expect(handIn(t, "marines", { faction: "marines", orders: [{ kind: "build", unit: "dragon", at: { system: "corva", sector: 0 } }] } as never)).toEqual({ ok: false, error: "Those aren't orders" });
  expect(handIn(t, "marines", empty("marines", { system: "nowhere", sector: 0 }))).toEqual({ ok: false, error: "No such sector for the hero" });
  expect(handIn(newTable({ marines: "human", wooka: "ai" }), "wooka", empty("wooka"))).toEqual({ ok: false, error: "That side isn't yours" });
});

test("a hero battle holds the turn for the hero's side, and the history row has the whole turn", () => {
  const t = newTable({ marines: "human", wooka: "human" }, "short", 7);
  const marines = { ...kessaFight(t), hero: { system: "kessa", sector: 0 } };
  const paused = ok(handIn(ok(handIn(t, "marines", marines)).table, "wooka", empty("wooka"))).table;
  const spec = paused.campaign.pending!.spec as BattleSpec;
  expect(waitingOn(paused)).toEqual(["marines"]);
  expect(handIn(paused, "wooka", empty("wooka"))).toEqual({ ok: false, error: "A hero battle has to be fought first" });
  const res = playGround(spec);
  expect(report(paused, "wooka", res)).toEqual({ ok: false, error: "That battle isn't yours" });
  const done = ok(report(paused, "marines", res));
  expect(done.table.campaign.turn).toBe(2);
  expect(done.table.resolving).toBeNull();
  expect(done.done).toMatchObject({ turn: 1, battle: kept(res) });
  expect(done.done!.orders.map((o) => o.faction)).toEqual(["marines", "wooka"]);
  expect(done.done!.log.some((l) => l.startsWith("Hero battle at Kessa shield generator: "))).toBe(true);
});

test("the Wooka have a hero of their own, and the turn still has one hero battle", () => {
  const t = newTable({ marines: "human", wooka: "human" }, "short", 7);
  const at = { system: "kessa", sector: 0 };
  const paused = ok(handIn(ok(handIn(t, "marines", { ...kessaFight(t), hero: at })).table, "wooka", empty("wooka", at))).table;
  // Both picked Kessa: the Marines' pick came first, so it's theirs.
  expect(paused.campaign.pending!.spec.hero).toBe("attacker");

  const t2 = newTable({ marines: "human", wooka: "human" }, "short", 7);
  const p2 = ok(handIn(ok(handIn(t2, "marines", kessaFight(t2))).table, "wooka", empty("wooka", at))).table;
  const spec = p2.campaign.pending!.spec as BattleSpec;
  expect(spec).toMatchObject({ hero: "defender", factions: { defender: "wooka" } });
  const res = playGround(spec);
  const after = ok(report(p2, "wooka", res)).table.campaign;
  expect(after.heroes.wooka.xp).toBe(res.heroDown ? 0 : res.winner === "defender" ? 2 : 1);
  expect(after.heroes.marines.xp).toBe(0);
});

// Kessa's orbit under the Wooka, with a Marine fleet coming in and the Wooka hero flying for it.
function orbitFight() {
  const t = newTable({ marines: "human", wooka: "human" }, "short", 7);
  t.campaign.systems.corva!.fleets.marines = 3;
  const k = t.campaign.systems.kessa!;
  k.fleets = { marines: 0, wooka: 2 };
  k.orbit = "wooka";
  const marines = { faction: "marines" as const, orders: [{ kind: "fleet" as const, from: "corva", to: "kessa", count: 3 }] };
  return { t, paused: ok(handIn(ok(handIn(t, "marines", marines)).table, "wooka", empty("wooka", { system: "kessa", sector: ORBIT }))).table };
}

test("a space hero battle goes through the table too, and its result finishes the turn", () => {
  const { t, paused } = orbitFight();
  expect(handIn(t, "marines", empty("marines", { system: "nowhere", sector: ORBIT }))).toEqual({ ok: false, error: "No such sector for the hero" });
  const p = paused.campaign.pending!;
  if (p.kind !== "space") throw new Error("expected a space battle");
  expect(p.spec).toMatchObject({ hero: "defender", factions: { defender: "wooka" } });
  expect(waitingOn(paused)).toEqual(["wooka"]);
  const res = playSpace(p.spec);
  const done = ok(report(paused, "wooka", res));
  expect(done.table.campaign).toMatchObject({ turn: 2, pending: null });
  expect(done.table.campaign.systems.kessa!.orbit).toBe(res.winner === "defender" ? "wooka" : "marines");
  expect(done.table.campaign.heroes.wooka.xp).toBe(res.heroDown ? 0 : res.winner === "defender" ? 2 : 1);
  expect(done.done).toMatchObject({ turn: 1, battle: kept(res) });
});

// The Marines' hero landing on Kessa's shield generator: the battle the next tests report on.
function heroAtKessa() {
  const t = newTable({ marines: "human", wooka: "human" }, "short", 7);
  const marines = { ...kessaFight(t), hero: { system: "kessa", sector: 0 } };
  const paused = ok(handIn(ok(handIn(t, "marines", marines)).table, "wooka", empty("wooka"))).table;
  return { paused, spec: paused.campaign.pending!.spec as BattleSpec };
}

test("a played result counts for nothing: the table plays the hero's inputs again and keeps its own result", () => {
  const { paused, spec } = heroAtKessa();
  const res = playGround(spec);
  const loser = other(res.winner);
  // Claim the other side won, by a mile, with junk riding along: the replay's result is kept.
  const forged = { ...res, winner: loser, tickets: { attacker: 999, defender: 999 }, heroDown: false, junk: "x".repeat(100) };
  const done = ok(report(paused, "marines", forged));
  expect(done.done!.battle).toEqual(kept(res));
});

test("a played result without the hero's inputs, or with a log that isn't one, is turned away", () => {
  const { paused, spec } = heroAtKessa();
  const res = { id: spec.id, winner: "attacker" as const, tickets: { attacker: 70, defender: 0 }, heroDown: false };
  expect(report(paused, "marines", res)).toEqual({ ok: false, error: "A played battle needs the hero's inputs" });
  expect(report(paused, "marines", { ...res, inputs: 5 } as never)).toEqual({ ok: false, error: "A played battle needs the hero's inputs" });
  expect(report(paused, "marines", { ...res, inputs: "A".repeat(MAX_INPUTS + 4) })).toEqual({ ok: false, error: "A played battle needs the hero's inputs" });
  expect(report(paused, "marines", { ...res, inputs: "not a log!" })).toEqual({ ok: false, error: "Those inputs don't make a battle" });
  expect(report(paused, "marines", { ...res, auto: false } as never)).toEqual({ ok: false, error: "That result doesn't add up" });
  expect(report(paused, "marines", { ...res, id: "nope", inputs: "" })).toEqual({ ok: false, error: "That isn't the battle being fought" });
});

test("a ground battle left to the AI is fought again at the table, and that run counts", () => {
  const { paused, spec } = heroAtKessa();
  const real = run(spec).over!;
  const claimed = { id: spec.id, winner: spec.hero, tickets: { attacker: 999, defender: 999 }, heroDown: false, auto: true as const };
  const done = ok(report(paused, "marines", claimed));
  expect(done.done!.battle).toEqual({ ...real, auto: true });
});

test("a space battle is played again too, left to the AI or from the hero's inputs", () => {
  const { paused } = orbitFight();
  const p = paused.campaign.pending!;
  if (p.kind !== "space") throw new Error("expected a space battle");
  const res = playSpace(p.spec);
  expect(ok(report(paused, "wooka", { ...res, fleets: { attacker: 0, defender: 9 } })).done!.battle).toEqual(kept(res));
  const real = runSpace(p.spec).over!;
  const done = ok(report(paused, "wooka", { id: p.spec.id, winner: "defender", fleets: { attacker: 0, defender: 2 }, heroDown: false, auto: true }));
  expect(done.done!.battle).toEqual({ ...real, auto: true });
});

test("attacks are declared, and the turn waits on the retreats of the sides they touch", () => {
  const t = newTable({ marines: "human", wooka: "human" }, "short", 7);
  const k = t.campaign.systems.kessa!;
  k.fleets = { marines: 2, wooka: 0 };
  k.orbit = "marines";
  const attack = { faction: "marines" as const, orders: [{ kind: "army" as const, from: { system: "corva", sector: 1 }, to: { system: "kessa", sector: 0 }, count: 2 }] };
  const one = handIn(t, "marines", attack);
  if (!one.ok) throw new Error(one.error);
  const asked = handIn(one.table, "wooka", empty("wooka"));
  if (!asked.ok) throw new Error(asked.error);
  expect(asked.table.campaign.turn).toBe(1);
  expect(asked.table.campaign.attacks).toEqual([{ faction: "marines", from: "corva", to: { system: "kessa", sector: 0 } }]);
  expect(waitingOn(asked.table)).toEqual(["marines", "wooka"]);
  expect(handIn(asked.table, "wooka", { faction: "wooka", orders: [], retreats: [{ kind: "calloff", to: { system: "kessa", sector: 0 } }] })).toEqual({ ok: false, error: "No attack of yours there" });
  const out = { faction: "wooka" as const, orders: [], retreats: [{ kind: "withdraw" as const, from: { system: "kessa", sector: 0 }, to: { system: "kessa", sector: 2 } }] };
  const w = handIn(asked.table, "wooka", out);
  if (!w.ok) throw new Error(w.error);
  expect(handIn(w.table, "wooka", out)).toEqual({ ok: false, error: "Retreats already in for this turn" });
  const done = ok(handIn(w.table, "marines", empty("marines")));
  expect(done.table.campaign).toMatchObject({ turn: 2, attacks: null });
  expect(done.table.campaign.systems.kessa!.sectors[0]!.owner).toBe("marines");
  expect(done.done!.orders[1]).toMatchObject({ faction: "wooka", retreats: out.retreats });
  // Orders hand in no retreats: those wait for the attacks.
  expect(handIn(t, "marines", { ...attack, retreats: out.retreats } as never)).toEqual({ ok: false, error: "Retreats come after the attacks are declared" });
});

test("after the fighting, a side that took somewhere deploys, and its deploys are in the history row", () => {
  const t = newTable({ marines: "human", wooka: "ai" }, "short", 7);
  const k = t.campaign.systems.kessa!;
  k.fleets = { marines: 2, wooka: 0 };
  k.orbit = "marines";
  k.sectors[0]!.armies.wooka = 0; // the shield generator stands empty
  const attack = { faction: "marines" as const, orders: [{ kind: "army" as const, from: { system: "corva", sector: 1 }, to: { system: "kessa", sector: 0 }, count: 2 }] };
  const declared = handIn(t, "marines", attack);
  if (!declared.ok) throw new Error(declared.error);
  expect(declared.table.campaign.attacks).toContainEqual({ faction: "marines", from: "corva", to: { system: "kessa", sector: 0 } });
  const fought = handIn(declared.table, "marines", empty("marines")); // no retreats
  if (!fought.ok) throw new Error(fought.error);
  expect(fought.table.campaign.turn).toBe(1);
  expect(fought.table.campaign.deploying).toContain("marines");
  expect(waitingOn(fought.table)).toEqual(["marines"]);
  expect(handIn(fought.table, "marines", { ...attack, deploys: [{ kind: "army", from: { system: "kessa", sector: 0 }, to: { system: "nyx", sector: 0 }, count: 1 }] }))
    .toEqual({ ok: false, error: "Armies redeploy between sectors you hold" });
  const deploys = [{ kind: "army" as const, from: { system: "kessa", sector: 0 }, to: { system: "corva", sector: 1 }, count: 1 }];
  const done = ok(handIn(fought.table, "marines", { faction: "marines", orders: [], deploys }));
  expect(done.table.campaign).toMatchObject({ turn: 2, deploying: null });
  expect(done.table.campaign.systems.kessa!.sectors[0]!.armies.marines).toBe(1);
  expect(done.done).toMatchObject({ turn: 1, battle: null });
  expect(done.done!.orders[0]).toMatchObject({ faction: "marines", deploys });
  // Deploys wait for the fighting.
  expect(handIn(t, "marines", { ...attack, deploys })).toEqual({ ok: false, error: "Deploys come after the fighting" });
});
