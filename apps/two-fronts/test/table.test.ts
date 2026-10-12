import { expect, test } from "bun:test";
import { handIn, newTable, report, waitingOn, type Step, type Table } from "../src/war/table.ts";
import { ORBIT, resolveTurn, type Where } from "../src/war/rules.ts";
import { run } from "../src/battle/sim.ts";
import { runSpace } from "../src/battle/space.ts";

const ok = (s: Step) => {
  if (!s.ok) throw new Error(s.error);
  return s;
};
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
  const spec = paused.campaign.pending!.spec;
  expect(waitingOn(paused)).toEqual(["marines"]);
  expect(handIn(paused, "wooka", empty("wooka"))).toEqual({ ok: false, error: "A hero battle has to be fought first" });
  const res = { id: spec.id, winner: "attacker" as const, tickets: { attacker: 70, defender: 0 }, heroDown: false };
  expect(report(paused, "wooka", res)).toEqual({ ok: false, error: "That battle isn't yours" });
  const done = ok(report(paused, "marines", res));
  expect(done.table.campaign.turn).toBe(2);
  expect(done.table.resolving).toBeNull();
  expect(done.done).toMatchObject({ turn: 1, battle: res });
  expect(done.done!.orders.map((o) => o.faction)).toEqual(["marines", "wooka"]);
  expect(done.done!.log).toContain("Hero battle at Kessa shield generator: Thunder Marines wins with 1 army left.");
});

test("the Wooka have a hero of their own, and the turn still has one hero battle", () => {
  const t = newTable({ marines: "human", wooka: "human" }, "short", 7);
  const at = { system: "kessa", sector: 0 };
  const paused = ok(handIn(ok(handIn(t, "marines", { ...kessaFight(t), hero: at })).table, "wooka", empty("wooka", at))).table;
  // Both picked Kessa: the Marines' pick came first, so it's theirs.
  expect(paused.campaign.pending!.spec.hero).toBe("attacker");

  const t2 = newTable({ marines: "human", wooka: "human" }, "short", 7);
  const p2 = ok(handIn(ok(handIn(t2, "marines", kessaFight(t2))).table, "wooka", empty("wooka", at))).table;
  const spec = p2.campaign.pending!.spec;
  expect(spec).toMatchObject({ hero: "defender", factions: { defender: "wooka" } });
  const after = ok(report(p2, "wooka", { id: spec.id, winner: "defender", tickets: { attacker: 0, defender: 40 }, heroDown: false })).table.campaign;
  expect(after.heroes.wooka.xp).toBe(2);
  expect(after.heroes.marines.xp).toBe(0);
});

test("a space hero battle goes through the table too, and its result finishes the turn", () => {
  const t = newTable({ marines: "human", wooka: "human" }, "short", 7);
  t.campaign.systems.corva!.fleets.marines = 3;
  const k = t.campaign.systems.kessa!;
  k.fleets = { marines: 0, wooka: 2 };
  k.orbit = "wooka";
  const orbit = { system: "kessa", sector: ORBIT };
  expect(handIn(t, "marines", empty("marines", { system: "nowhere", sector: ORBIT }))).toEqual({ ok: false, error: "No such sector for the hero" });
  const marines = { faction: "marines" as const, orders: [{ kind: "fleet" as const, from: "corva", to: "kessa", count: 3 }] };
  const paused = ok(handIn(ok(handIn(t, "marines", marines)).table, "wooka", empty("wooka", orbit))).table;
  const p = paused.campaign.pending!;
  expect(p.kind).toBe("space");
  expect(p.spec).toMatchObject({ hero: "defender", factions: { defender: "wooka" } });
  expect(waitingOn(paused)).toEqual(["wooka"]);
  const res = { id: p.spec.id, winner: "defender" as const, fleets: { attacker: 0, defender: 1 }, heroDown: false };
  const done = ok(report(paused, "wooka", res));
  expect(done.table.campaign).toMatchObject({ turn: 2, pending: null });
  expect(done.table.campaign.systems.kessa!).toMatchObject({ orbit: "wooka", fleets: { marines: 0, wooka: 1 } });
  expect(done.table.campaign.heroes.wooka.xp).toBe(2);
  expect(done.done).toMatchObject({ turn: 1, battle: res });
});

// The Marines' hero landing on Kessa's shield generator: the battle the next tests report on.
function heroAtKessa() {
  const t = newTable({ marines: "human", wooka: "human" }, "short", 7);
  const marines = { ...kessaFight(t), hero: { system: "kessa", sector: 0 } };
  return ok(handIn(ok(handIn(t, "marines", marines)).table, "wooka", empty("wooka"))).table;
}

test("a played result has to fit the battle: no tickets from nowhere, and the winner has the most", () => {
  const paused = heroAtKessa();
  const spec = paused.campaign.pending!.kind === "ground" ? paused.campaign.pending!.spec : null!;
  const most = spec.tickets.attacker + spec.reinforcements.attacker;
  const bad = { ok: false as const, error: "That result doesn't add up" };
  const res = (tickets: { attacker: unknown; defender: unknown }, more = {}) => ({ id: spec.id, winner: "attacker" as const, tickets, heroDown: false, ...more }) as never;
  expect(report(paused, "marines", res({ attacker: most + 1, defender: 0 }))).toEqual(bad);
  expect(report(paused, "marines", res({ attacker: -1, defender: 0 }))).toEqual(bad);
  expect(report(paused, "marines", res({ attacker: 1.5, defender: 0 }))).toEqual(bad);
  expect(report(paused, "marines", res({ attacker: "70", defender: 0 }))).toEqual(bad);
  expect(report(paused, "marines", res({ attacker: 5, defender: 10 }))).toEqual(bad);
  expect(report(paused, "marines", res({ attacker: 5, defender: 0 }, { heroDown: "no" }))).toEqual(bad);
  expect(report(paused, "marines", res({ attacker: 5, defender: 0 }, { auto: false }))).toEqual(bad);
  // Junk riding along with a good result stays out of the history.
  const done = ok(report(paused, "marines", res({ attacker: most, defender: 0 }, { junk: "x".repeat(100) })));
  expect(done.done!.battle).toEqual({ id: spec.id, winner: "attacker", tickets: { attacker: most, defender: 0 }, heroDown: false });
});

test("a ground battle left to the AI is fought again at the table, and that run counts", () => {
  const paused = heroAtKessa();
  const spec = paused.campaign.pending!.kind === "ground" ? paused.campaign.pending!.spec : null!;
  const real = run(spec).over!;
  const claimed = { id: spec.id, winner: spec.hero, tickets: { attacker: 999, defender: 999 }, heroDown: false, auto: true as const };
  const done = ok(report(paused, "marines", claimed));
  expect(done.done!.battle).toEqual({ ...real, auto: true });
});

test("a space battle left to the AI is fought again too, and a played one can't bring more cruisers than it had", () => {
  const t = newTable({ marines: "human", wooka: "human" }, "short", 7);
  t.campaign.systems.corva!.fleets.marines = 3;
  const k = t.campaign.systems.kessa!;
  k.fleets = { marines: 0, wooka: 2 };
  k.orbit = "wooka";
  const marines = { faction: "marines" as const, orders: [{ kind: "fleet" as const, from: "corva", to: "kessa", count: 3 }] };
  const paused = ok(handIn(ok(handIn(t, "marines", marines)).table, "wooka", empty("wooka", { system: "kessa", sector: ORBIT }))).table;
  const p = paused.campaign.pending!;
  if (p.kind !== "space") throw new Error("expected a space battle");
  expect(report(paused, "wooka", { id: p.spec.id, winner: "defender", fleets: { attacker: 0, defender: 3 }, heroDown: false }))
    .toEqual({ ok: false, error: "That result doesn't add up" });
  const real = runSpace(p.spec).over!;
  const done = ok(report(paused, "wooka", { id: p.spec.id, winner: "defender", fleets: { attacker: 0, defender: 2 }, heroDown: false, auto: true }));
  expect(done.done!.battle).toEqual({ ...real, auto: true });
});
