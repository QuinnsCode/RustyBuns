// A guest list: who is in a place (a Qollab space, a studio sesh, a game's room), what each of them may do, and who let them
// in. One owner; roles with a rank and a list of what they allow (RBAC); invites that hand out a role; revokes, blocks and a
// log of every change. Headless and pure: the server keeps one `GuestList`, runs each `GuestAct` a page sends through `act`,
// and the page draws it with `guestPanel` (./guest-panel.ts) or a look of its own from `guestRows` and `powers`.
//
// Ranks keep it safe without settings: you act only on people ranked below you, and hand out only roles below your own,
// so a mod can't promote themselves or kick the person who made them a mod. The owner is above every role.
import { Bad, arr, bool, int, obj, oneOf, opt, rec, str, type Guard, type Of } from "./guard.ts";

/** What the list itself checks. An app adds its own (Qollab Studio's play, edit, mix, lead) beside these. */
export const MOD_PERMS = ["invite", "revoke", "block", "roles"] as const;
export type ModPerm = (typeof MOD_PERMS)[number];
/** How much a list keeps: past these an invite or a join is refused, and the log forgets its oldest lines. */
export const LIMITS = { guests: 500, invites: 50, blocked: 500, roles: 12, log: 200 } as const;
/** The owner's rank: above any role's (a role ranks 0 to 99). */
export const OWNER_RANK = 100;

const ID = str(80, { min: 1 });
const NAME = str(60, { dflt: "Someone" });
const PERM = str(24, { re: /^[a-z][a-z0-9-]*$/ });
const AT = int(0, 1e15);

export const Role = obj({ id: str(24, { re: /^[a-z][a-z0-9-]*$/ }), name: str(40, { min: 1 }), rank: int(0, OWNER_RANK - 1), perms: arr(PERM, 32) });
export type Role = Of<typeof Role>;
/** Someone on the list: their role, who let them in (`by`, the owner's id for the first ones), when, and the invite they used. */
export const Guest = obj({ name: NAME, role: str(24), by: ID, at: AT, via: opt(str(40)) });
export type Guest = Of<typeof Guest>;
/** An invite: the role it hands out, who made it, until when (ms), and how many uses it has left (none: any number). */
export const Invite = obj({ code: str(40, { min: 4 }), role: str(24), by: ID, at: AT, until: opt(AT), left: opt(int(0, 10_000)), used: int(0, 1e9) });
export type Invite = Of<typeof Invite>;
export const Blocked = obj({ name: NAME, by: ID, at: AT, why: opt(str(200)) });
export type Blocked = Of<typeof Blocked>;
export const LOG_ACTS = ["invite", "uninvite", "join", "leave", "role", "revoke", "block", "unblock", "roles"] as const;
export const Entry = obj({ at: AT, by: ID, act: oneOf(LOG_ACTS), who: opt(ID), name: opt(NAME), role: opt(str(24)), code: opt(str(40)) });
export type Entry = Of<typeof Entry>;

export const GuestList = obj({
  owner: ID, ownerName: NAME,
  /** Highest rank first. The last one is where someone lands whose role was taken away. */
  roles: arr(Role, LIMITS.roles, { min: 1 }),
  guests: rec(Guest, LIMITS.guests), invites: arr(Invite, LIMITS.invites), blocked: rec(Blocked, LIMITS.blocked), log: arr(Entry, LIMITS.log),
});
export type GuestList = Of<typeof GuestList>;

/** Roles for any place: mods keep order, members bring friends, guests just come. An app passes its own to `guestList`. */
export const HOUSE_ROLES: Role[] = [
  { id: "mod", name: "Mod", rank: 50, perms: ["invite", "revoke", "block", "roles"] },
  { id: "member", name: "Member", rank: 10, perms: ["invite"] },
  { id: "guest", name: "Guest", rank: 0, perms: [] },
];

export const guestList = (owner: string, ownerName: string, roles: Role[] = HOUSE_ROLES): GuestList =>
  ({ owner, ownerName, roles: sortRoles(roles), guests: {}, invites: [], blocked: {}, log: [] });

const sortRoles = (roles: Role[]) => [...roles].sort((a, b) => b.rank - a.rank);
const roleOf = (l: GuestList, who: string): Role | undefined => {
  const g = l.guests[who];
  return g ? l.roles.find((r) => r.id === g.role) ?? l.roles[l.roles.length - 1] : undefined;
};
/** Where someone stands: the owner above everyone, a guest at their role's rank, anyone else (and the blocked) below all. */
export const rankOf = (l: GuestList, who: string): number => who === l.owner ? OWNER_RANK : l.blocked[who] ? -1 : roleOf(l, who)?.rank ?? -1;
/** Whether `who` may do `perm` here: the owner always, a blocked or unlisted person never, a guest when their role says so. */
export const can = (l: GuestList, who: string, perm: string): boolean =>
  who === l.owner || (!l.blocked[who] && !!roleOf(l, who)?.perms.includes(perm));
/** Whether `who` is let in at all: the owner or a guest, and not blocked. */
export const isIn = (l: GuestList, who: string): boolean => who === l.owner || (!!l.guests[who] && !l.blocked[who]);
export const nameOf = (l: GuestList, who: string): string => who === l.owner ? l.ownerName : l.guests[who]?.name ?? l.blocked[who]?.name ?? "Someone";

// ---------- what a page asks for ----------

const ACTS = {
  invite: obj({ t: oneOf(["invite"]), role: str(24), uses: opt(int(1, 10_000)), hours: opt(int(1, 24 * 30)) }),
  uninvite: obj({ t: oneOf(["uninvite"]), code: str(40) }),
  join: obj({ t: oneOf(["join"]), code: str(40), name: NAME }),
  leave: obj({ t: oneOf(["leave"]) }),
  role: obj({ t: oneOf(["role"]), who: ID, role: str(24) }),
  /** `all`: everyone they brought in goes too (and whoever those brought), as far as the asker outranks them. */
  revoke: obj({ t: oneOf(["revoke"]), who: ID, all: opt(bool()) }),
  block: obj({ t: oneOf(["block"]), who: ID, why: opt(str(200)) }),
  unblock: obj({ t: oneOf(["unblock"]), who: ID }),
  /** The owner's alone: the roles themselves (names, ranks, what each allows). */
  roles: obj({ t: oneOf(["roles"]), roles: arr(Role, LIMITS.roles, { min: 1 }) }),
} as const;
type Acts = { [K in keyof typeof ACTS]: Of<(typeof ACTS)[K]> };
export type GuestAct = Acts[keyof Acts];
/** One thing a page asks the list to do, read off the wire: a 400's worth of `Bad` when it isn't one. */
export const GuestAct: Guard<GuestAct> = (v) => {
  const t = obj({ t: oneOf(Object.keys(ACTS) as (keyof typeof ACTS)[]) })(v).t;
  return ACTS[t](v);
};

export type Acted = { ok: true; list: GuestList } | { ok: false; why: string };
const no = (why: string): Acted => ({ ok: false, why });
const logged = (l: GuestList, e: Entry): GuestList => ({ ...l, log: [...l.log, e].slice(-LIMITS.log) });

/** Take someone off: out of the guests, and the open invites they made go with them. */
function drop(l: GuestList, who: string): GuestList {
  const { [who]: _, ...guests } = l.guests;
  return { ...l, guests, invites: l.invites.filter((i) => i.by !== who) };
}
/** Everyone `who` brought in, and whoever those brought, as far as `rank` outranks them. */
function broughtBy(l: GuestList, who: string, rank: number): string[] {
  const out: string[] = [], seen = new Set([who]);
  for (let i = -1; i < out.length; i++) {
    const from = i < 0 ? who : out[i];
    for (const [id, g] of Object.entries(l.guests)) if (g.by === from && !seen.has(id) && rankOf(l, id) < rank) { seen.add(id); out.push(id); }
  }
  return out;
}

/**
 * Run one act for `by` at `now`. `code` is the new invite's code, the server's to pick (random, unguessable); the rest of
 * the acts ignore it. Every change lands in the log; a refusal says why in words the panel shows.
 */
export function act(l: GuestList, by: string, a: GuestAct, now: number, code = ""): Acted {
  const mine = rankOf(l, by), byName = nameOf(l, by);
  const target = "who" in a ? a.who : undefined;
  // An id like "toString" is found on any object: written to the list it fails the list's own guard, and the list is lost.
  if (target !== undefined && Object.hasOwn(Object.prototype, target)) return no("They're not on the list.");
  if (target !== undefined && target === by && a.t !== "unblock") return no("That's you.");
  if (target !== undefined && a.t !== "unblock" && rankOf(l, target) >= mine && target !== l.owner && (l.guests[target] || a.t === "block")) return no(`${nameOf(l, target)} ranks as high as you.`);
  if (target === l.owner) return no("Nobody can do that to the owner.");
  const role = "role" in a ? l.roles.find((r) => r.id === a.role) : undefined;
  switch (a.t) {
    case "invite": {
      if (!can(l, by, "invite")) return no("You can't invite people here.");
      if (!role) return no("There's no such role.");
      if (role.rank >= mine) return no(`You can only hand out roles below your own.`);
      if (l.invites.length >= LIMITS.invites) return no("Too many open invites: take one back first.");
      if (code.length < 4 || l.invites.some((i) => i.code === code)) return no("That invite code didn't work: try again.");
      const inv: Invite = { code, role: role.id, by, at: now, used: 0, ...(a.uses ? { left: a.uses } : {}), ...(a.hours ? { until: now + a.hours * 3_600_000 } : {}) };
      return { ok: true, list: logged({ ...l, invites: [...l.invites, inv] }, { at: now, by, act: "invite", role: role.id, code }) };
    }
    case "uninvite": {
      const inv = l.invites.find((i) => i.code === a.code);
      if (!inv) return no("That invite is already gone.");
      if (inv.by !== by && !(can(l, by, "revoke") && rankOf(l, inv.by) < mine)) return no("Only who made it, or a mod above them, can take it back.");
      return { ok: true, list: logged({ ...l, invites: l.invites.filter((i) => i !== inv) }, { at: now, by, act: "uninvite", code: a.code }) };
    }
    case "join": {
      if (isIn(l, by)) return { ok: true, list: l };
      if (l.blocked[by]) return no("You can't come in here.");
      const inv = l.invites.find((i) => i.code === a.code);
      if (!inv || (inv.until !== undefined && now >= inv.until) || inv.left === 0) return no("That invite has run out. Ask for a new one.");
      if (Object.keys(l.guests).length >= LIMITS.guests) return no("The list is full.");
      const invites = l.invites.map((i) => i === inv ? { ...i, used: i.used + 1, ...(i.left !== undefined ? { left: i.left - 1 } : {}) } : i);
      const guests = { ...l.guests, [by]: { name: a.name, role: inv.role, by: inv.by, at: now, via: inv.code } };
      return { ok: true, list: logged({ ...l, guests, invites }, { at: now, by, act: "join", name: a.name, role: inv.role, code: inv.code }) };
    }
    case "leave":
      if (!l.guests[by]) return no("You're not on the list.");
      return { ok: true, list: logged(drop(l, by), { at: now, by, act: "leave", name: byName }) };
    case "role": {
      if (!can(l, by, "roles")) return no("You can't change roles here.");
      if (!l.guests[a.who]) return no("They're not on the list.");
      if (!role) return no("There's no such role.");
      if (role.rank >= mine) return no("You can only hand out roles below your own.");
      return { ok: true, list: logged({ ...l, guests: { ...l.guests, [a.who]: { ...l.guests[a.who], role: role.id } } }, { at: now, by, act: "role", who: a.who, name: nameOf(l, a.who), role: role.id }) };
    }
    case "revoke": {
      if (!can(l, by, "revoke")) return no("You can't take people off here.");
      if (!l.guests[a.who]) return no("They're not on the list.");
      const gone = [a.who, ...(a.all ? broughtBy(l, a.who, mine) : [])];
      let next = l;
      for (const id of gone) next = logged(drop(next, id), { at: now, by, act: "revoke", who: id, name: nameOf(l, id) });
      return { ok: true, list: next };
    }
    case "block": {
      if (!can(l, by, "block")) return no("You can't block people here.");
      if (l.blocked[a.who]) return { ok: true, list: l };
      if (Object.keys(l.blocked).length >= LIMITS.blocked) return no("The block list is full.");
      const name = nameOf(l, a.who), next = drop(l, a.who);
      return { ok: true, list: logged({ ...next, blocked: { ...next.blocked, [a.who]: { name, by, at: now, ...(a.why ? { why: a.why } : {}) } } }, { at: now, by, act: "block", who: a.who, name }) };
    }
    case "unblock": {
      if (!can(l, by, "block")) return no("You can't unblock people here.");
      const b = l.blocked[a.who];
      if (!b) return { ok: true, list: l };
      if (b.by !== by && rankOf(l, b.by) >= mine) return no(`${nameOf(l, b.by)} blocked them; ask them.`);
      const { [a.who]: _, ...blocked } = l.blocked;
      return { ok: true, list: logged({ ...l, blocked }, { at: now, by, act: "unblock", who: a.who, name: b.name }) };
    }
    case "roles": {
      if (by !== l.owner) return no("Only the owner changes the roles.");
      const ids = new Set(a.roles.map((r) => r.id));
      if (ids.size !== a.roles.length) return no("Two roles share a name.");
      const roles = sortRoles(a.roles), last = roles[roles.length - 1].id;
      // someone whose role went lands on the lowest one; an invite for a gone role goes
      const guests = Object.fromEntries(Object.entries(l.guests).map(([id, g]) => [id, ids.has(g.role) ? g : { ...g, role: last }]));
      return { ok: true, list: logged({ ...l, roles, guests, invites: l.invites.filter((i) => ids.has(i.role)) }, { at: now, by, act: "roles" }) };
    }
  }
}

/** `act`, but throwing `Bad` with the refusal: for a server that answers a refusal as a 400. */
export function mustAct(l: GuestList, by: string, a: GuestAct, now: number, code?: string): GuestList {
  const r = act(l, by, a, now, code);
  if (!r.ok) throw new Bad(r.why);
  return r.list;
}

// ---------- what a page draws ----------

/** One line of the list as the panel draws it: the owner first, then each person under whoever brought them in. */
export interface GuestRow { id: string; name: string; role: Role | null; by: string | null; byName: string | null; at: number; depth: number; brought: number }

export function guestRows(l: GuestList): GuestRow[] {
  const kids = new Map<string, string[]>();
  for (const [id, g] of Object.entries(l.guests)) {
    const from = g.by in l.guests || g.by === l.owner ? g.by : l.owner;
    kids.set(from, [...(kids.get(from) ?? []), id]);
  }
  const rows: GuestRow[] = [], seen = new Set<string>();
  const walk = (id: string, depth: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    const g = l.guests[id], under = (kids.get(id) ?? []).sort((a, b) => rankOf(l, b) - rankOf(l, a) || l.guests[a].at - l.guests[b].at);
    rows.push({ id, name: nameOf(l, id), role: g ? roleOf(l, id) ?? null : null, by: g?.by ?? null, byName: g ? nameOf(l, g.by) : null, at: g?.at ?? 0, depth, brought: under.length });
    for (const k of under) walk(k, depth + 1);
  };
  walk(l.owner, 0);
  return rows;
}

/** What `me` may do to `who`: the roles they may hand them, and whether they may take them off or block them. */
export interface Powers { roles: Role[]; revoke: boolean; block: boolean }
export function powers(l: GuestList, me: string, who: string): Powers {
  const mine = rankOf(l, me), over = who !== me && who !== l.owner && rankOf(l, who) < mine;
  return {
    roles: over && can(l, me, "roles") ? l.roles.filter((r) => r.rank < mine) : [],
    revoke: over && !!l.guests[who] && can(l, me, "revoke"),
    block: over && can(l, me, "block"),
  };
}
/** The roles `me` may put on an invite. */
export const invitable = (l: GuestList, me: string): Role[] => can(l, me, "invite") ? l.roles.filter((r) => r.rank < rankOf(l, me)) : [];
/** An invite that can still let someone in at `now`. */
export const live = (i: Invite, now: number): boolean => (i.until === undefined || now < i.until) && i.left !== 0;
