// Jetstream: Bluesky's public firehose as JSON over a WebSocket, filtered on the server by account and collection.
// No key, no sign-in. Docs: https://bsky.network/docs/jetstream/
import { check, obj, opt, raw, str } from "@rustybuns/util/guard";

export const JETSTREAM = "wss://jetstream.us-east.bsky.network/xrpc/network.bsky.jetstream.subscribeEvents";

/** The subscribe URL for these accounts and collections (none: all), commits only, picking up after `cursor`. */
export function streamUrl(o: { dids?: string[]; collections?: string[]; cursor?: number }): string {
  const q = new URLSearchParams({ kinds: "commit" });
  for (const d of o.dids ?? []) q.append("dids", d);
  for (const c of o.collections ?? []) q.append("collections", c);
  if (o.cursor) q.set("cursor", String(o.cursor));
  return `${JETSTREAM}?${q}`;
}

const Frame = obj({
  payload: obj({
    $type: str(200),
    seq: raw,
    did: str(2048),
    operation: opt(str(20)),
    collection: opt(str(317)),
    rkey: opt(str(512)),
    record: raw,
  }),
});

export interface Commit {
  seq: number;
  did: string;
  op: "create" | "update" | "delete";
  collection: string;
  rkey: string;
  record: unknown;
}

/** A frame's commit, or null for anything else (identity and account events, a shape this doesn't know). */
export function decodeCommit(v: unknown): Commit | null {
  const p = check(Frame, v)?.payload;
  if (!p || !p.$type.endsWith("#commit") || !p.collection || !p.rkey) return null;
  const op = p.operation === "create" || p.operation === "update" || p.operation === "delete" ? p.operation : null;
  if (!op) return null;
  return { seq: typeof p.seq === "number" ? p.seq : 0, did: p.did, op, collection: p.collection, rkey: p.rkey, record: p.record };
}

/** A field of something parsed, still unknown. */
const field = (o: unknown, k: string): unknown => (typeof o === "object" && o !== null ? Reflect.get(o, k) : undefined);

/** One line saying what a record is: a post's text, a like's subject, else its createdAt. */
export function gist(record: unknown): string {
  for (const k of ["text", "displayName", "name", "title", "description", "status"]) {
    const v = field(record, k);
    if (typeof v === "string" && v) return v.slice(0, 280);
  }
  const subject = field(record, "subject"), uri = field(subject, "uri");
  if (typeof subject === "string") return subject;
  if (typeof uri === "string") return uri;
  const at = field(record, "createdAt");
  return typeof at === "string" ? at : "";
}
