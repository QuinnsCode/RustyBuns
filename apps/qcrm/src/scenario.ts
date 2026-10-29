// POST /api/scenario {name}: a throwaway account signed in on a populated workspace, for hands-on
// checks and for agents. Local only (BETTER_AUTH_URL is http://: the dev server, the desktop, the
// tests); a deployment answers 404. The org is plan 'demo', so the hourly sweep (demo.ts) removes it.
//
//   GET  /api/scenario        {scenarios: [{name, view, about}]}
//   POST /api/scenario {name} 201 {org, user, view}, with the session cookie
//
// Every scenario but `empty` is the same workspace: 300 contacts, five of them soft-deleted, the
// three example scripts, one webhook with an ok, a failed-and-waiting and a dead delivery, and
// three members (manager, employee, seasonal). They differ in the screen they land on.

import type { User } from "./auth.ts";
import { throwaway } from "./demo.ts";
import { error, json, readBody, type Env } from "./env.ts";
import { addMember, createOrg } from "./orgs.ts";
import { insert } from "./scripts.ts";
import { EXAMPLES } from "./script-examples.ts";
import { seedOrg } from "./seed-data.ts";
import { EVENTS } from "./webhooks.ts";

export const SCENARIOS = {
  empty: { view: "contacts", about: "a new org with nothing in it" },
  populated: { view: "contacts", about: "300 contacts, deals, activities, and the rest below" },
  deleted: { view: "settings", about: "five contacts soft-deleted, on Settings where the export is" },
  webhooks: { view: "settings", about: "a webhook with an ok, a waiting and a dead delivery, on Settings" },
  members: { view: "settings", about: "a manager, an employee and a seasonal member, on Settings" },
  contact: { view: "contacts", about: "the populated workspace with one live contact open in its sheet" },
  scripts: { view: "scripts", about: "the three example scripts, on Scripts" },
} as const;
export type Scenario = keyof typeof SCENARIOS;
export const isScenario = (n: unknown): n is Scenario => typeof n === "string" && Object.hasOwn(SCENARIOS, n);

const MEMBERS = [["manager", "Maya Manager"], ["employee", "Eli Employee"], ["seasonal", "Sam Seasonal"]] as const;

export async function scenarioRoute(req: Request, env: Env): Promise<Response> {
  if (!env.BETTER_AUTH_URL?.startsWith("http://")) return error(404, "not found");
  if (req.method === "GET") return json({ scenarios: Object.entries(SCENARIOS).map(([name, s]) => ({ name, ...s })) });
  if (req.method !== "POST") return error(405, "POST {name} to land in a scenario");
  const name = (await readBody<{ name?: unknown }>(req))?.name;
  if (!isScenario(name)) return error(400, `name: one of ${Object.keys(SCENARIOS).join(", ")}`);

  const made = await throwaway(req, env, "Scenario");
  if (!made) return error(500, "could not make the account");
  const { user, headers } = made;
  const org = await createOrg(env, user, `Scenario: ${name}`, "demo");
  if (name !== "empty") await populate(req, env, org.id, user);
  // `open` is the row the page should show in its sheet (?entity=&id= does the same for any row).
  const first = name === "contact" ? await env.DB.prepare("SELECT id FROM contacts WHERE org_id = ? AND deleted_at IS NULL ORDER BY id LIMIT 1").bind(org.id).first<{ id: string }>() : null;

  const res = json({ org: { ...org, role: "admin" }, user, view: SCENARIOS[name].view, ...(first && { open: { entity: "contacts", id: first.id } }) }, 201);
  for (const c of headers.getSetCookie()) res.headers.append("set-cookie", c);
  return res;
}

async function populate(req: Request, env: Env, org: string, user: User) {
  const owner = user.id;
  await seedOrg(env, org, owner, 300, 7);
  const now = Date.now();
  // Deleted the way the API deletes (deleted_at set, a change row for sync), without the webhook events.
  const gone = await env.DB.prepare("SELECT id FROM contacts WHERE org_id = ? ORDER BY id LIMIT 5").bind(org).all<{ id: string }>();
  await env.DB.batch(gone.results.flatMap((c) => [
    env.DB.prepare("UPDATE contacts SET deleted_at = ?, updated_at = ? WHERE id = ?").bind(now, now, c.id),
    env.DB.prepare("INSERT INTO changes (org_id, entity, entity_id, op, actor_user_id, at, data) VALUES (?, 'contacts', ?, 'delete', ?, ?, ?)").bind(org, c.id, owner, now, JSON.stringify({ id: c.id, deleted_at: now, updated_at: now })),
  ]));
  for (const e of EXAMPLES) await insert(env, org, owner, e.name, e.body);

  // Members are throwaway accounts added the way an owner adds one (before the hook, so no delivery of theirs is queued).
  for (const [role, who] of MEMBERS) {
    const m = await throwaway(req, env, who, "scenario");
    if (m) await addMember(env, org, user, "admin", m.user.email, role);
  }

  // A hook nobody listens at (.invalid never resolves), with deliveries written straight in so no request is sent.
  const hook = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO webhooks (id, org_id, url, events, secret, created_at, disabled) VALUES (?, ?, ?, ?, ?, ?, 0)")
    .bind(hook, org, "https://hooks.scenario.invalid/qcrm", JSON.stringify(EVENTS), "scenario-secret", now).run();
  const delivery = (event: string, status: string, attempts: number, code: number | null, ago: number) =>
    env.DB.prepare("INSERT INTO webhook_deliveries (id, webhook_id, org_id, event, payload, status, attempts, next_at, last_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), hook, org, event, JSON.stringify({ event, org, at: now - ago, data: { id: crypto.randomUUID() } }), status, attempts, status === "pending" ? now + 365 * 86_400_000 : null, code, now - ago);
  await env.DB.batch([delivery("contact.created", "ok", 1, 200, 3 * 60_000), delivery("deal.updated", "pending", 3, 503, 2 * 60_000), delivery("contact.deleted", "dead", 8, 0, 60_000)]);

}
