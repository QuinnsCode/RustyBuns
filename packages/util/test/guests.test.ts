// A guest list through a night at a studio: the owner invites a mod, the mod brings friends, a friend of a friend gets
// blocked, and the ranks keep everyone below whoever let them in.
import { expect, test } from "bun:test";
import { Bad } from "../src/guard.ts";
import { GuestAct, GuestList, act, can, guestList, guestRows, invitable, mustAct, powers, type GuestAct as Act } from "../src/guests.ts";

const T = 1_700_000_000_000;

test("invite, join, bring friends, block and revoke: who did what, and the ranks hold", () => {
  let l = guestList("ada", "Ada");
  const run = (by: string, a: Act, code?: string) => { l = mustAct(l, by, a, T, code); };
  run("ada", { t: "invite", role: "mod", uses: 1 }, "MODS1");
  run("grace", { t: "join", code: "MODS1", name: "Grace" });
  expect(can(l, "grace", "block")).toBe(true);
  // a one-use invite is spent
  expect(act(l, "eve", { t: "join", code: "MODS1", name: "Eve" }, T)).toEqual({ ok: false, why: "That invite has run out. Ask for a new one." });

  // the mod can hand out member and guest, never mod
  expect(invitable(l, "grace").map((r) => r.id)).toEqual(["member", "guest"]);
  expect(act(l, "grace", { t: "invite", role: "mod" }, T, "NOPE1").ok).toBe(false);
  run("grace", { t: "invite", role: "member", hours: 1 }, "FRIEND");
  run("lin", { t: "join", code: "FRIEND", name: "Lin" });
  run("lin", { t: "invite", role: "guest" }, "LINS");
  run("max", { t: "join", code: "LINS", name: "Max" });
  // an hour on, Grace's invite has run out
  expect(act(l, "zed", { t: "join", code: "FRIEND", name: "Zed" }, T + 3_600_000).ok).toBe(false);

  // the list reads as a tree: who brought whom
  expect(guestRows(l).map((r) => [r.name, r.depth, r.byName])).toEqual([["Ada", 0, null], ["Grace", 1, "Ada"], ["Lin", 2, "Grace"], ["Max", 3, "Lin"]]);
  expect(l.guests.max).toMatchObject({ by: "lin", via: "LINS", role: "guest" });

  // a member can't touch anyone, a mod can't touch the owner or promote to mod
  expect(powers(l, "lin", "max")).toEqual({ roles: [], revoke: false, block: false });
  expect(act(l, "grace", { t: "revoke", who: "ada" }, T).ok).toBe(false);
  expect(act(l, "grace", { t: "role", who: "lin", role: "mod" }, T).ok).toBe(false);

  // Grace blocks Max: out, and can't come back on another invite
  run("grace", { t: "block", who: "max", why: "spam" });
  run("lin", { t: "invite", role: "guest" }, "AGAIN");
  expect(act(l, "max", { t: "join", code: "AGAIN", name: "Max" }, T)).toEqual({ ok: false, why: "You can't come in here." });

  // taking Lin off with everyone they brought takes their open invites too
  run("ada", { t: "invite", role: "guest" }, "OPEN1");
  run("kim", { t: "join", code: "AGAIN", name: "Kim" });
  run("grace", { t: "revoke", who: "lin", all: true });
  expect(Object.keys(l.guests)).toEqual(["grace"]);
  expect(l.invites.map((i) => i.code)).toEqual(["OPEN1"]);

  // the owner takes the mod role away: Grace lands on the lowest role and loses her powers
  run("ada", { t: "roles", roles: l.roles.filter((r) => r.id !== "mod") });
  expect([l.guests.grace.role, can(l, "grace", "block")]).toEqual(["guest", false]);
  expect(l.log.map((e) => e.act)).toEqual(["invite", "join", "invite", "join", "invite", "join", "block", "invite", "invite", "join", "revoke", "revoke", "roles"]);
  // and what the keeper stored reads back through the same guard
  expect(GuestList(JSON.parse(JSON.stringify(l)))).toEqual(l);
});

test("a page's act is checked before it runs", () => {
  for (const bad of [{ t: "nuke" }, { t: "role", who: "x" }, { t: "invite", role: "guest", uses: -1 }, "block"]) expect(() => GuestAct(bad)).toThrow(Bad);
  expect(GuestAct({ t: "block", who: "x", extra: 1 })).toEqual({ t: "block", who: "x" });
});
