// GET /api/orgs/:org/directory?entity=contacts|companies: every live row's id and name in one compact
// answer, for the browser's similar-name index (engine.ts `nameIndex`), so "is Jon Smyth already
// here?" is answered on the device with no round trip per keystroke. Rows are arrays in `fields`
// order, not objects: 100,000 contacts stay a few MB before gzip.

import { demoRows, isDemo } from "./demo-snapshot.ts";
import { error, json } from "./env.ts";
import type { Ctx } from "./orgs.ts";

const FIELDS = { contacts: ["id", "first_name", "last_name", "email"], companies: ["id", "name", "domain"] } as const;
const MAX = 100_000;

export async function directoryRoutes({ req, env, url, org, p }: Ctx): Promise<Response | null> {
  if (p[0] !== "directory" || p[1] || req.method !== "GET") return null;
  const entity = url.searchParams.get("entity") ?? "contacts";
  if (entity !== "contacts" && entity !== "companies") return error(400, "entity: contacts or companies");
  const fields = FIELDS[entity];
  const rows = (await isDemo(env, org))
    ? (await demoRows(env, org, entity)).slice(0, MAX).map((r) => fields.map((f) => r[f] ?? null))
    : (await env.DB.prepare(`SELECT ${fields.join(", ")} FROM ${entity} WHERE org_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?`).bind(org, MAX).all()).results.map((r) => fields.map((f) => r[f] ?? null));
  return json({ entity, fields, rows, total: rows.length, capped: rows.length === MAX });
}
