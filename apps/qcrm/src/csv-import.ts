// CSV import for contacts and companies: POST /api/orgs/:org/<contacts|companies>/import
//
//   body   text/csv, multipart/form-data with a `file`, or JSON {"csv": "…", "map": {"Header": "field"}}
//   ?map=  the same map as JSON in the query, for the first two
//
// Headers map to fields by name (case, spaces and punctuation ignored, a few aliases like "E-mail");
// a map names the rest, and "" or "-" skips a column. Rows are checked like a single create. A row
// whose email (contacts) or domain/name (companies) is already in the org, or earlier in the file, is
// skipped and counted as a duplicate.

import { createRow, ENTITIES, type Entity } from "./crm.ts";
import { error, json } from "./env.ts";
import type { Ctx } from "./orgs.ts";
import { can } from "./rbac.ts";

export const MAX_IMPORT_ROWS = 5000, MAX_IMPORT_BYTES = 2_000_000;
const ALIASES: Record<string, string> = {
  firstname: "first_name", first: "first_name", givenname: "first_name", lastname: "last_name", last: "last_name", surname: "last_name", familyname: "last_name",
  email: "email", emailaddress: "email", mail: "email", phone: "phone", phonenumber: "phone", mobile: "phone", telephone: "phone",
  jobtitle: "title", position: "title", role: "title", company: "company_name", companyname: "company_name", organization: "company_name", organisation: "company_name",
  tag: "tags", labels: "tags", note: "notes", comments: "notes", website: "domain", url: "domain", sector: "industry", employees: "size", companysize: "size",
};
const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** RFC 4180-ish: quoted fields, "" escapes, CRLF or LF, a BOM. Blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
    } else if (c === '"' && !cell) quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

/** The field each header feeds ("" for none). */
export function mapHeaders(entity: Entity, headers: string[], map: Record<string, string> = {}): string[] {
  const fields = ENTITIES[entity]!.fields;
  const byFlat = Object.fromEntries(Object.entries(map).map(([h, f]) => [flat(h), f]));
  return headers.map((h) => {
    const k = flat(h);
    if (k in byFlat) { const f = byFlat[k]!; return f in fields ? f : ""; }
    const f = Object.hasOwn(fields, h.trim()) ? h.trim() : Object.hasOwn(fields, k) ? k : ALIASES[k];
    return f && f in fields ? f : "";
  });
}

const dupeKey = (entity: Entity, r: Record<string, unknown>) =>
  entity === "contacts" ? (r.email as string | undefined)?.toLowerCase() : ((r.domain as string | undefined) || (r.name as string | undefined))?.trim().toLowerCase();

export interface ImportResult { created: number; duplicates: number; failed: number; errors: { row: number; error: string }[] }

export async function importCsv({ env, org, user }: Ctx, entity: Entity, text: string, map?: Record<string, string>): Promise<ImportResult | string> {
  if (text.length > MAX_IMPORT_BYTES) return `at most ${MAX_IMPORT_BYTES / 1e6} MB of CSV`;
  const [head, ...body] = parseCsv(text);
  if (!head) return "the CSV is empty";
  if (body.length > MAX_IMPORT_ROWS) return `at most ${MAX_IMPORT_ROWS} rows an import`;
  const fields = mapHeaders(entity, head, map);
  const used = fields.filter(Boolean);
  if (!used.length) return `no column matches a ${entity.slice(0, -1)} field (${Object.keys(ENTITIES[entity]!.fields).join(", ")})`;

  // What the org already has, to skip against.
  const seen = new Set<string>();
  const col = entity === "contacts" ? "email" : "domain";
  const { results } = await env.DB.prepare(`SELECT ${col}${entity === "companies" ? ", name" : ""} FROM ${entity} WHERE org_id = ? AND deleted_at IS NULL`).bind(org).all();
  for (const r of results) { const k = dupeKey(entity, r); if (k) seen.add(k); if (entity === "companies" && !r.domain && typeof r.name === "string") seen.add(r.name.toLowerCase()); }

  const out: ImportResult = { created: 0, duplicates: 0, failed: 0, errors: [] };
  for (let i = 0; i < body.length; i++) {
    const data: Record<string, unknown> = {};
    fields.forEach((f, j) => {
      const v = (body[i]![j] ?? "").trim();
      if (!f || !v) return;
      data[f] = f === "tags" ? v.split(/[;|]/).map((t) => t.trim()).filter(Boolean) : v;
    });
    const key = dupeKey(entity, { ...data, email: typeof data.email === "string" ? data.email : undefined });
    if (key && seen.has(key)) { out.duplicates++; continue; }
    const made = await createRow(env, org, entity, data, user.id);
    if (typeof made === "string") { out.failed++; if (out.errors.length < 50) out.errors.push({ row: i + 2, error: made }); continue; }
    out.created++;
    if (key) seen.add(key);
  }
  return out;
}

/** The route for POST …/import on contacts or companies. */
export async function importRoute(ctx: Ctx, entity: Entity): Promise<Response> {
  const { req, url, role } = ctx;
  if (!can(role, entity === "contacts" ? "create:contact" : "create:company")) return error(403, `a ${role} can't add ${entity}`);
  let text = "", map: Record<string, string> | undefined;
  try {
    const type = req.headers.get("content-type") ?? "";
    if (type.includes("multipart/form-data")) {
      const f = (await req.formData()).get("file");
      if (!f || typeof f === "string") return error(400, "send the CSV as a file field named file");
      text = await f.text();
    } else if (type.includes("json")) {
      const b = await req.json() as { csv?: unknown; map?: Record<string, string> };
      if (typeof b?.csv !== "string") return error(400, "send {\"csv\": \"…\"}");
      text = b.csv; map = b.map;
    } else text = await req.text();
    const q = url.searchParams.get("map");
    if (q) map = JSON.parse(q);
  } catch { return error(400, "couldn't read the CSV or its map"); }
  const r = await importCsv(ctx, entity, text, map);
  return typeof r === "string" ? error(400, r) : json(r, r.created ? 201 : 200);
}
