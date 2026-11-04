// eqosys's half of voice channels (QLAVE.md): the one-use ticket a member takes to Qlave, and the orders eqosys sends
// it when the owner mutes or kicks, an account is deleted, or a space or voice channel goes. Both are ES256 JWTs from
// eqosys's own key (`sign` in @rustybuns/util/token), so Qlave checks them against the same JWKS the games do.
import { arr, check, int, obj, str, type Of } from "@rustybuns/util/guard";
import { sign, type Signer } from "@rustybuns/util/token";
import { HOME } from "./apps.ts";

/** Where Qlave lives; QLAVE_URL points a dev server or a test at another one. */
export const qlaveUrl = (conf: { QLAVE_URL?: string }) => (conf.QLAVE_URL ?? "https://qlave.dev").replace(/\/$/, "");

/** How long a ticket or an order's token is good for, in seconds. Qlave refuses a ticket that lives longer. */
export const TICKET_S = 60;

/** A voice room's name on Qlave: one space's one voice channel. Voice channel ids are all one length, so `end` by prefix hits only its own room. */
export const roomOf = (space: string, channel: string) => `space:${space}:${channel}`;

/** A ticket into `room` for this person, good once and for 60 seconds; null with no signing key. */
export const ticket = (conf: Signer, iss: string, who: { id: string; name: string }, room: string, now = Date.now()) =>
  sign(conf, iss, { user: { id: who.id, email: "", name: who.name }, app: "qlave", source: HOME, access: [] }, now, { room, jti: crypto.randomUUID() }, TICKET_S);

/** What eqosys asks of Qlave. */
export type Order =
  | { t: "mute"; room: string; sub: string; on: boolean }
  | { t: "kick"; room: string; sub: string }
  | { t: "erase"; sub: string }
  | { t: "end"; prefix: string };

/**
 * One try at an order. "done" on 200; "drop" on 401 or 400 (a bad token or a bad order: trying again won't help, and
 * no signing key is the same); "retry" on anything else, a network failure included.
 */
export async function send(conf: Signer & { QLAVE_URL?: string }, iss: string, order: Order, now = Date.now()): Promise<"done" | "drop" | "retry"> {
  const token = await sign(conf, iss, { user: { id: "eqosys", email: "", name: "eqosys" }, app: "qlave-admin", source: HOME, access: [] }, now, {}, TICKET_S);
  if (!token) return "drop";
  const res = await fetch(`${qlaveUrl(conf)}/eqosys`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(order), signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  return res?.status === 200 ? "done" : res?.status === 401 || res?.status === 400 ? "drop" : "retry";
}

/** Who is in one voice room, as Qlave POSTs it to /q/qlave/roster (QLAVE.md §4). Up to 12 people a room. */
export const Present = arr(obj({ sub: str(200, { min: 1 }), name: str(200) }), 12);
export const Roster = obj({ room: str(200, { min: 1 }), in: Present, at: int(0, 1e15) });
export type Roster = Of<typeof Roster>;
/** How far a roster's `at` may be from now, either way. */
export const ROSTER_SKEW_MS = 60_000;

/** A room name back into its space and voice channel; null for anything not `space:<uuid>:v<8 hex>`. */
export const roomParts = (room: string) => {
  const m = /^space:([0-9a-f-]{36}):(v[0-9a-f]{8})$/.exec(room);
  return m ? { space: m[1]!, channel: m[2]! } : null;
};

/** Whether `sig` (lowercase hex) is the HMAC-SHA256 of `body` under `secret`. crypto.subtle.verify compares in constant time. */
export async function rosterSigned(secret: string, body: string, sig: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(sig)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = Uint8Array.from(sig.match(/../g)!, (h) => parseInt(h, 16));
  return crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(body));
}

/** Qlave's roster POST, checked: 401 unsigned, 400 malformed or stale, else what to forward to the space. */
export async function rosterIn(req: Request, secret: string | undefined, now = Date.now()): Promise<{ status: 401 | 400 } | { space: string; channel: string; roster: Roster }> {
  const body = await req.text();
  if (!secret || !await rosterSigned(secret, body, req.headers.get("x-qlave-signature") ?? "")) return { status: 401 };
  let parsed: unknown = null;
  try { parsed = JSON.parse(body); } catch { /* bad JSON is a bad body */ }
  const roster = check(Roster, parsed), parts = roster && roomParts(roster.room);
  if (!roster || !parts || Math.abs(roster.at - now) > ROSTER_SKEW_MS) return { status: 400 };
  return { ...parts, roster };
}
