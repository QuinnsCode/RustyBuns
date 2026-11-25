// One Alchemy state file -> a Resource that is safe to put on a screen. Pure: no fs, so the page and tests use it too.
//
// The persisted row (alchemy/src/State/ResourceState.ts) holds `props` (what the program asked for) and `attr` (what
// the cloud gave back). Both can carry secrets: Alchemy writes a Redacted value as `{ "__redacted__": "<the value>" }`,
// in plain text. So nothing from props or attr is copied except `name` and `url` from ATTR_NAME / ATTR_URL below,
// and only when the value is a short plain string with no line breaks and no credentials in a URL.
import { isRecord } from "@rustybuns/util/guard";
import { STATUSES, type Resource, type Status } from "./api.ts";

/** Attr fields that name the thing on the account, first one set wins. Public by nature: they're in the dashboard. */
const ATTR_NAME = ["workerName", "scriptName", "databaseName", "bucketName", "queueName", "indexName", "name", "title"] as const;
/** Attr fields that are where it answers. */
const ATTR_URL = ["url", "workerUrl", "hostname", "domain"] as const;

const isStatus = (v: unknown): v is Status => typeof v === "string" && (STATUSES as readonly string[]).includes(v);

/** A short single-line string, or nothing. */
const plain = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.length > 0 && v.length <= max && !/[\r\n]/.test(v) ? v : undefined;

/** An http(s) URL with no user or password in it, or a bare host name. */
function publicUrl(v: unknown): string | undefined {
  const s = plain(v, 500);
  if (!s) return undefined;
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s)) return `https://${s}`;
  try {
    const u = new URL(s);
    return (u.protocol === "https:" || u.protocol === "http:") && !u.username && !u.password && !u.search ? u.href : undefined;
  } catch { return undefined; }
}

const first = <T>(keys: readonly string[], get: (k: string) => unknown, pick: (v: unknown) => T | undefined): T | undefined => {
  for (const k of keys) { const v = pick(get(k)); if (v !== undefined) return v; }
  return undefined;
};

/** The row for `fqn`, or null when the file isn't a resource row (an action row, the stack output, a bad file). */
export function resourceOf(fqn: string, row: unknown, updatedAt: number): Resource | null {
  if (!isRecord(row) || row.kind === "action" || row.kind === "task") return null;
  if (typeof row.resourceType !== "string" || !isStatus(row.status)) return null;
  const attr = isRecord(row.attr) ? row.attr : {};
  const downstream = Array.isArray(row.downstream) ? row.downstream.filter((d): d is string => typeof d === "string" && d.length <= 500) : [];
  const local = row.providerMode === "local" || (row.providerMode === undefined && typeof attr.id === "string" && attr.id.startsWith("dev:"));
  const r: Resource = {
    fqn: fqn.slice(0, 500),
    type: row.resourceType.slice(0, 200),
    status: row.status,
    downstream: [...new Set(downstream)].slice(0, 1000),
    bindings: Array.isArray(row.bindings) ? Math.min(row.bindings.length, 10_000) : 0,
    props: isRecord(row.props) ? Math.min(Object.keys(row.props).length, 10_000) : 0,
    kept: row.removalPolicy === "retain" || row.removalPolicy === "protect",
    mode: local ? "local" : "live",
    updatedAt: Math.max(0, Math.round(updatedAt)),
  };
  const name = first(ATTR_NAME, (k) => attr[k], (v) => plain(v, 200));
  const url = first(ATTR_URL, (k) => attr[k], publicUrl);
  if (name) r.name = name;
  if (url) r.url = url;
  return r;
}

/** Alchemy's file name for an FQN back to the FQN (alchemy/src/FQN.ts: `/` is written `__`). */
export const fqnOfFile = (file: string) => file.replace(/\.json$/, "").replaceAll("__", "/");
