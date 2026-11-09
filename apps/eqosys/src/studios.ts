// Studios: the account that makes apps, beside the person's account that plays them (VISION.md). One person, a team or a business,
// with the same shape at every size: members with a role, and the apps the studio makes. Each app on a studio's shelf shows the
// four doors: play it (its site), keep (the person's own saves and unlocks in it, already in eqosys), make (its code, once a
// codeSplitter repo is linked) and ship: live, and the stage, version and time its last deploy reported (deploys.ts), or not deployed yet.
//
// QNTBR is the first studio, the super admin's (`house`): it holds every app in APPS that no other studio has claimed.
import { oneOf, str } from "@rustybuns/util/guard";
import { APPS, appOf } from "./apps.ts";
import type { Env } from "./env.ts";
import { lastDeploys, type Shipped } from "./deploys.ts";

export const KINDS = ["solo", "team", "business"] as const;
export type Kind = (typeof KINDS)[number];
export const ROLES = ["owner", "admin", "maker"] as const;
export type Role = (typeof ROLES)[number];
export const Kind = oneOf(KINDS), Role = oneOf(ROLES);
export const STUDIO_NAME = str(60, { min: 1 });
/** Studios a person may own. */
export const OWNED = 3;

/** The super admin's studio: a fixed id, so making it twice is a no-op. */
export const HOUSE = { id: "qntbr", name: "QNTBR", kind: "business" as Kind };

/** `ship` is "live" once the app has reported a deploy, or has a site in APPS (an app shipped before reports began); `shipped` is that report. */
export interface ShelfApp { id: string; name: string; play: string | null; make: string | null; ship: "live" | "not deployed"; shipped: Shipped | null }
export interface StudioPerson { name: string; email: string; role: Role }
export interface Studio { id: string; name: string; kind: Kind; role: Role; members: number; people: StudioPerson[]; apps: ShelfApp[] }

const shelfApp = (id: string, repo: string | null, shipped: Shipped | null): ShelfApp => {
  const a = appOf(id);
  return { id, name: a?.name ?? id, play: a?.origins[0] ?? null, make: repo, ship: shipped || a?.origins.length ? "live" : "not deployed", shipped };
};

/** The studios a person is in, with their role, who else is in (owners first), and each app on the shelf. */
export async function studiosOf(conf: Env, userId: string): Promise<Studio[]> {
  const { results: mine } = await conf.DB.prepare(
    `SELECT s.id, s.name, s.kind, m.role, (SELECT COUNT(*) FROM studio_members c WHERE c.studio_id = s.id) AS members
     FROM studio_members m JOIN studios s ON s.id = m.studio_id WHERE m.user_id = ? ORDER BY s.name`,
  ).bind(userId).all<{ id: string; name: string; kind: Kind; role: Role; members: number }>();
  if (!mine.length) return [];
  const ids = mine.map((s) => s.id), marks = ids.map(() => "?").join(", ");
  const [{ results: apps }, { results: people }] = await Promise.all([
    conf.DB.prepare(`SELECT app, studio_id, repo FROM studio_apps WHERE studio_id IN (${marks}) ORDER BY app`).bind(...ids).all<{ app: string; studio_id: string; repo: string | null }>(),
    conf.DB.prepare(`SELECT m.studio_id, u.name, u.email, m.role FROM studio_members m JOIN "user" u ON u.id = m.user_id WHERE m.studio_id IN (${marks})
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name`).bind(...ids).all<StudioPerson & { studio_id: string }>(),
  ]);
  const shipped = await lastDeploys(conf, apps.map((a) => a.app));
  return mine.map((s) => ({ ...s,
    people: people.filter((p) => p.studio_id === s.id).map(({ name, email, role }) => ({ name, email, role })),
    apps: apps.filter((a) => a.studio_id === s.id).map((a) => shelfApp(a.app, a.repo, shipped.get(a.app) ?? null)) }));
}

export type Made = { ok: true; id: string } | { ok: false; status: number; error: string };

/** A new studio with `owner` as its owner; at most OWNED a person. */
export async function makeStudio(conf: Env, owner: string, name: string, kind: Kind, now = Date.now(), id: string = crypto.randomUUID()): Promise<Made> {
  const n = await conf.DB.prepare("SELECT COUNT(*) AS n FROM studio_members WHERE user_id = ? AND role = 'owner'").bind(owner).first<number>("n") ?? 0;
  if (n >= OWNED && id !== HOUSE.id) return { ok: false, status: 409, error: `you own ${OWNED} studios already` };
  await conf.DB.batch([
    conf.DB.prepare("INSERT INTO studios (id, name, kind, at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING").bind(id, name.trim(), kind, now),
    conf.DB.prepare("INSERT INTO studio_members (studio_id, user_id, role, at) VALUES (?, ?, 'owner', ?) ON CONFLICT DO NOTHING").bind(id, owner, now),
  ]);
  return { ok: true, id };
}

/** `who`'s role in a studio, or null. */
export const roleIn = (conf: Env, studio: string, who: string) =>
  conf.DB.prepare("SELECT role FROM studio_members WHERE studio_id = ? AND user_id = ?").bind(studio, who).first<Role>("role");

/** Puts someone in a studio by email (an owner or admin asks; only an owner makes another owner). */
export async function addMember(conf: Env, studio: string, by: string, email: string, role: Role, now = Date.now()): Promise<Made> {
  const mine = await roleIn(conf, studio, by);
  if (mine !== "owner" && mine !== "admin") return { ok: false, status: 403, error: "only a studio's owner or admin adds people" };
  if (role === "owner" && mine !== "owner") return { ok: false, status: 403, error: "only an owner makes another owner" };
  const u = await conf.DB.prepare(`SELECT id FROM "user" WHERE lower(email) = lower(?)`).bind(email.trim()).first<string>("id");
  if (!u) return { ok: false, status: 404, error: "nobody has signed up with that email" };
  await conf.DB.prepare("INSERT INTO studio_members (studio_id, user_id, role, at) VALUES (?, ?, ?, ?) ON CONFLICT (studio_id, user_id) DO UPDATE SET role = excluded.role")
    .bind(studio, u, role, now).run();
  return { ok: true, id: studio };
}

/**
 * The super admin's studio, made the first time it is asked for: QNTBR, a business, with the super admin as owner and every app in
 * APPS that no studio holds yet on its shelf (a new app in APPS lands there the next time). One read when there is nothing to do.
 */
export async function house(conf: Env, adminId: string, now = Date.now()) {
  const { results } = await conf.DB.prepare("SELECT app FROM studio_apps").all<{ app: string }>();
  const held = new Set(results.map((r) => r.app)), loose = APPS.filter((a) => !held.has(a.id));
  const there = await roleIn(conf, HOUSE.id, adminId);
  if (there && !loose.length) return;
  if (!there) await makeStudio(conf, adminId, HOUSE.name, HOUSE.kind, now, HOUSE.id);
  if (loose.length) await conf.DB.batch(loose.map((a) => conf.DB.prepare("INSERT INTO studio_apps (app, studio_id, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(a.id, HOUSE.id, now)));
}

/** Deleting an account: a studio it owned alone goes with it (apps freed, members out); in the rest it just leaves. */
export function studioErase(conf: Env, userId: string) {
  const alone = `SELECT studio_id FROM studio_members m WHERE m.user_id = ?1 AND m.role = 'owner'
    AND NOT EXISTS (SELECT 1 FROM studio_members o WHERE o.studio_id = m.studio_id AND o.role = 'owner' AND o.user_id <> ?1)`;
  return [
    conf.DB.prepare(`DELETE FROM studio_apps WHERE studio_id IN (${alone})`).bind(userId),
    conf.DB.prepare(`DELETE FROM studios WHERE id IN (${alone})`).bind(userId),
    conf.DB.prepare(`DELETE FROM studio_members WHERE studio_id NOT IN (SELECT id FROM studios)`),
    conf.DB.prepare("DELETE FROM studio_members WHERE user_id = ?").bind(userId),
  ];
}
