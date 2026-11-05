// Files on rows: a contact's signed contract, a company's logo, a deal's quote. The bytes are in R2
// (FILES) under <org>/<entity>/<row>/<file>, one lane per client row, so an org's files list and
// delete by prefix; D1's `files` table is the index and what the quota adds up.
//
//   GET    /api/orgs/:org/files?entity=&id=      a row's files, newest first (or the org's newest 100)
//   POST   /api/orgs/:org/files?entity=&id=&name=   the bytes as the body, their content-type as sent
//   POST   /api/orgs/:org/files {entity, id, name, type?, text | base64}   the same as JSON, for agents and MCP
//   GET    /api/orgs/:org/files/:file            one file's row, plus `text` when it is short text
//   GET    /api/orgs/:org/files/:file/content    the bytes, always as a download
//   DELETE /api/orgs/:org/files/:file            manager+, or whoever added it
//
// Trials get very little: a demo or scenario org holds a few small files, and its files go when the
// hourly sweep deletes the org (deleteOrg calls dropFiles). Downloads are attachments with a
// sandbox CSP, and only plain image, PDF and text types keep their type: an HTML or SVG upload comes
// back as octet-stream, so a file can never run as a page on this origin.

import { check, obj, oneOf, opt, str } from "@rustybuns/util/guard";
import { getRow } from "./crm.ts";
import { error, json, readBody, type Env } from "./env.ts";
import type { Ctx } from "./orgs.ts";
import { can, rank } from "./rbac.ts";
import { emit } from "./webhooks.ts";

export const LANES = ["contacts", "companies", "deals"] as const;
export type Lane = (typeof LANES)[number];

/** What an org may keep, by plan. Trials are a taste, not a drive. */
export const LIMITS: Record<string, { file: number; total: number; count: number }> = {
  free: { file: 10 << 20, total: 250 << 20, count: 5000 },
  demo: { file: 256 << 10, total: 1 << 20, count: 5 },
  scenario: { file: 256 << 10, total: 1 << 20, count: 5 },
};
const limitsFor = (plan: string | null | undefined) => LIMITS[plan ?? "free"] ?? LIMITS.free!;

/** Types a browser may show as themselves; everything else downloads as bytes. */
const SAFE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain", "text/csv", "application/json"]);
const TEXTY = /^(text\/|application\/json)/;
const FILE_ID = /^[A-Za-z0-9-]{1,64}$/;
const ROW_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface FileRow { id: string; org_id: string; entity: Lane; entity_id: string; name: string; type: string; size: number; created_by: string | null; created_at: number }

/** A name safe as a download name and in a key-free index: no slashes, no control characters, 200 at most. */
const cleanName = (s: string) => s.replace(/[\\/\u0000-\u001f\u007f"]/g, "_").trim().slice(0, 200) || "file";
const cleanType = (s: string | null | undefined) => {
  const t = (s ?? "").split(";")[0]!.trim().toLowerCase();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(t) ? t : "application/octet-stream";
};
const keyOf = (f: Pick<FileRow, "org_id" | "entity" | "entity_id" | "id">) => `${f.org_id}/${f.entity}/${f.entity_id}/${f.id}`;

const JsonUpload = obj({ entity: oneOf(LANES), id: str(64, { re: ROW_ID }), name: str(200), type: opt(str(100)), text: opt(str(1 << 20, { min: 0 })), base64: opt(str(14 << 20)) });

/** Every file of an org, gone from R2. The D1 rows go with the org's other tables (ORG_TABLES). */
export async function dropFiles(env: Env, org: string) {
  if (!env.FILES) return;
  for (let cursor: string | undefined; ;) {
    const page = await env.FILES.list({ prefix: `${org}/`, cursor, limit: 1000 });
    if (page.objects.length) await env.FILES.delete(page.objects.map((o) => o.key));
    if (!page.truncated || !page.cursor) break;
    cursor = page.cursor;
  }
}

const b64 = (s: string) => { try { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); } catch { return null; } };

/** The upload's bytes and what it says it is, or why not. */
async function upload(req: Request, url: URL, max: number): Promise<{ entity: Lane; id: string; name: string; type: string; bytes: Uint8Array } | string> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  const isJson = cleanType(req.headers.get("content-type")) === "application/json" && !url.searchParams.has("name");
  // JSON carries base64 (4 bytes per 3), so it may be a third bigger than the file it holds.
  if (declared > (isJson ? Math.ceil(max * 4 / 3) + 4096 : max)) return `too big: a file here is at most ${max >> 10} KB`;
  if (isJson) {
    const b = check(JsonUpload, await readBody(req));
    if (!b) return "send {entity, id, name, text} or {entity, id, name, base64}, or the bytes with ?entity=&id=&name=";
    const bytes = b.text !== undefined ? new TextEncoder().encode(b.text) : b.base64 !== undefined ? b64(b.base64) : null;
    if (!bytes) return "text or base64 (valid base64) is required";
    return { entity: b.entity, id: b.id, name: b.name, type: cleanType(b.type ?? (b.text !== undefined ? "text/plain" : null)), bytes };
  }
  const entity = url.searchParams.get("entity"), id = url.searchParams.get("id") ?? "", name = url.searchParams.get("name") ?? "";
  if (!LANES.some((l) => l === entity) || !ROW_ID.test(id) || !name) return `?entity= (${LANES.join(", ")}), ?id= and ?name= are required`;
  return { entity: entity as Lane, id, name, type: cleanType(req.headers.get("content-type")), bytes: new Uint8Array(await req.arrayBuffer()) };
}

const shown = (f: FileRow) => ({ ...f, content: `/api/orgs/${f.org_id}/files/${f.id}/content` });

export async function fileRoutes({ req, env, url, user, org, role, p, audit }: Ctx): Promise<Response | null> {
  if (p[0] !== "files") return null;
  if (!env.FILES) return error(503, "files are off here: this install has no file storage");
  const files = env.FILES;

  if (!p[1] && req.method === "GET") {
    const entity = url.searchParams.get("entity"), id = url.searchParams.get("id");
    const plan = await env.DB.prepare("SELECT plan FROM orgs WHERE id = ?").bind(org).first<string>("plan");
    const used = await env.DB.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM files WHERE org_id = ?").bind(org).first<{ count: number; bytes: number }>();
    const { results } = entity && id
      ? await env.DB.prepare("SELECT * FROM files WHERE org_id = ? AND entity = ? AND entity_id = ? ORDER BY created_at DESC LIMIT 200").bind(org, entity, id).all<FileRow>()
      : await env.DB.prepare("SELECT * FROM files WHERE org_id = ? ORDER BY created_at DESC LIMIT 100").bind(org).all<FileRow>();
    return json({ items: results.map(shown), used: used ?? { count: 0, bytes: 0 }, limits: limitsFor(plan) });
  }

  if (!p[1] && req.method === "POST") {
    if (!can(role, "update")) return error(403, `a ${role} can't add files`);
    const plan = await env.DB.prepare("SELECT plan FROM orgs WHERE id = ?").bind(org).first<string>("plan");
    const lim = limitsFor(plan);
    const up = await upload(req, url, lim.file);
    if (typeof up === "string") return error(up.startsWith("too big") ? 413 : 400, up);
    if (up.bytes.byteLength > lim.file) return error(413, `too big: a file here is at most ${lim.file >> 10} KB`);
    if (!up.bytes.byteLength) return error(400, "the file is empty");
    if (!(await getRow(env, org, up.entity, up.id))) return error(404, `no such ${up.entity.replace(/(ie)?s$/, (_m, ie) => (ie ? "y" : ""))}`);
    const used = await env.DB.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM files WHERE org_id = ?").bind(org).first<{ count: number; bytes: number }>();
    if ((used?.count ?? 0) >= lim.count || (used?.bytes ?? 0) + up.bytes.byteLength > lim.total)
      return error(413, plan === "demo" || plan === "scenario" ? `a trial org keeps ${lim.count} files and ${lim.total >> 10} KB: make an account for more` : `this org is full: ${lim.count} files or ${lim.total >> 20} MB`);
    const f: FileRow = { id: crypto.randomUUID(), org_id: org, entity: up.entity, entity_id: up.id, name: cleanName(up.name), type: up.type, size: up.bytes.byteLength, created_by: user.id, created_at: Date.now() };
    await files.put(keyOf(f), up.bytes, { httpMetadata: { contentType: f.type } });
    await env.DB.prepare("INSERT INTO files (id, org_id, entity, entity_id, name, type, size, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(f.id, org, f.entity, f.entity_id, f.name, f.type, f.size, f.created_by, f.created_at).run();
    await emit(env, org, "file.added", { id: f.id, entity: f.entity, entity_id: f.entity_id, name: f.name, type: f.type, size: f.size });
    return json(shown(f), 201);
  }

  if (!p[1] || !FILE_ID.test(p[1])) return null;
  const f = await env.DB.prepare("SELECT * FROM files WHERE id = ? AND org_id = ?").bind(p[1], org).first<FileRow>();
  if (!f) return error(404, "no such file");

  if (!p[2] && req.method === "GET") {
    // Short text comes inline, so an agent reads a note or a CSV in one call.
    const text = TEXTY.test(f.type) && f.size <= 64 << 10 ? await (await files.get(keyOf(f)))?.text() : undefined;
    return json({ ...shown(f), ...(text !== undefined && { text }) });
  }
  if (p[2] === "content" && !p[3] && req.method === "GET") {
    const o = await files.get(keyOf(f));
    if (!o) return error(404, "the file's bytes are gone");
    return new Response(o.body, { headers: {
      "content-type": SAFE.has(f.type) ? f.type : "application/octet-stream",
      "content-disposition": `attachment; filename="${f.name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      "content-security-policy": "default-src 'none'; sandbox", "content-length": String(f.size),
    } });
  }
  if (!p[2] && req.method === "DELETE") {
    if (!can(role, "delete") && !(f.created_by === user.id && rank(role) >= rank("employee"))) return error(403, `a ${role} can delete only the files they added`);
    await files.delete(keyOf(f));
    await env.DB.prepare("DELETE FROM files WHERE id = ?").bind(f.id).run();
    await audit("file.delete", f.id, f.name);
    await emit(env, org, "file.deleted", { id: f.id, entity: f.entity, entity_id: f.entity_id });
    return json({ ok: true });
  }
  return null;
}
