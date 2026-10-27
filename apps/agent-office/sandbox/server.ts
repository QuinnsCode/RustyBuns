// The box's page, server half (built into rb-box.js): the permission set to read and edit, and the box's health.
// Signed-in only, like the other /__rb/ routes: a worker on the hook port never reaches it, so none can grant itself a mount.
// Edits go to box.json and reach the running box when it is started again (`bun run office:box up`).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { boxHealth, edit, hostCapacity, limits, parsePerms, permsFile, savePerms, type Edit, type Perms } from "./box.ts";

const dir = () => process.env.OFFICE_BOX_DIR ?? path.join(process.cwd(), "sandbox");

function current(d: string): { perms: Perms; from: string } {
  const file = [permsFile(d), path.join(d, "box.example.json")].find(existsSync);
  if (!file) throw new Error(`no permission set in ${d}`);
  return { perms: parsePerms(JSON.parse(readFileSync(file, "utf8"))), from: path.basename(file) };
}

/** The edit a request asks for, or an error to show: a query is text until each field is looked at. */
export function editOf(q: URLSearchParams): Edit | string {
  const what = q.get("do"), arg = q.get("path") ?? "", access = q.get("access");
  if (what === "grant") return access === "rw" || access === "ro" ? { grant: { path: arg, access } } : "access should be rw or ro";
  if (what === "revoke") return { revoke: arg };
  if (what === "network") { const v = q.get("value"); return v === "open" || v === "allowlist" || v === "offline" ? { network: v } : 'network should be "allowlist", "open" or "offline"'; }
  if (what === "allow") return { allow: { host: q.get("value") ?? "", on: q.get("on") !== "0" } };
  if (what === "port") return { port: Number(q.get("value")) };
  if (what === "env") return { env: { name: q.get("value") ?? "", on: q.get("on") !== "0" } };
  return "unknown change";
}

export function boxRoute(d: () => string = dir) {
  return async (method: string, url: URL): Promise<{ status: number; body: unknown } | null> => {
    if (url.pathname !== "/__rb/box") return null;
    try {
      let { perms, from } = current(d());
      if (method === "POST") {
        const e = editOf(url.searchParams);
        if (typeof e === "string") return { status: 400, body: { error: e } };
        perms = edit(perms, e);
        savePerms(perms, d());
        from = "box.json";
      } else if (method !== "GET") return null;
      const host = await hostCapacity().catch(() => null);
      const health = await boxHealth(perms).catch(() => ({ running: false as const }));
      return { status: 200, body: { from, perms, limits: host && limits(perms, host), health, docker: host !== null } };
    } catch (e) {
      return { status: 400, body: { error: e instanceof Error ? e.message : String(e) } };
    }
  };
}
