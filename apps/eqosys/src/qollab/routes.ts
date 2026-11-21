// Qollab's paths: a person's hub (one Durable Object a player) and the rooms they meet in (a party a room code, a space a group),
// plus cloud saves and Qlave's voice roster. Every one is entered with an app's token (door.ts), never a session cookie, so this
// file and the rest of qollab/ could move to a Worker of their own with nothing else changing (QOLLAB.md).
import { onSite } from "../apps.ts";
import { json, loopbackOn, type Env } from "../env.ts";
import { bearerOf, cors, echoProtocol, issuer, socketToken, tokenOf } from "../door.ts";
import { hubAsk, hubOf, Op } from "./hub.ts";
import { codeOf, mintCode, PARTY_LIFE, PARTY_LIFE_MAX, partyOf } from "./party.ts";
import { FILE_MAX, makeSpace, ROLE_OF, seatIn, SPACE_MEMBERS, SPACE_NAME, SPACES_OF, spaceOf } from "./space.ts";
import { rosterIn } from "./qlave.ts";
import { board, isBoard } from "./board.ts";
import { get as getSave, MAX_BODY, put as putSave, slotOf } from "./saves.ts";
import type { SpaceRow } from "@rustybuns/util/eqosys";
import { RoomMintGate } from "@rustybuns/util/limits";
import { check, obj, opt, str } from "@rustybuns/util/guard";

const mints = new RoomMintGate(12, 60_000);

/** How many different party codes or space invites one account, or one address, may try in a minute. A person tries one or two
 *  (the same one again is free); a script guessing codes tries thousands. In memory, so per isolate: a speed bump on top of codes
 *  too many to guess, not a global count. */
export const TRIES_PER_MINUTE = 20;
const tries = new RoomMintGate(TRIES_PER_MINUTE, 60_000);
const tryCode = (req: Request, who: string, code: string) => {
  const ip = req.headers.get("cf-connecting-ip"), now = Date.now();
  return tries.allow(`who:${who}`, code, now) && (!ip || tries.allow(`ip:${ip}`, code, now));
};

/** The paths below, the ones eqosys hands to Qollab's own Worker. `/q/achieve` is eqosys's (achievements). */
export const isQollab = (pathname: string) =>
  /^\/(?:hub|api\/hub|q\/party(?:\/[^/]+)?|q\/space(?:\/[^/]+(?:\/file(?:\/[^/]+)?)?)?|q\/qlave\/roster|q\/save\/[^/]+)$/.test(pathname) || isBoard(pathname);

/** A Qollab path's answer, or null when the path isn't Qollab's. */
export async function qollab(req: Request, conf: Env): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  // Posts and reactions (board.ts): read signed out, written with the app's token.
  if (isBoard(pathname)) return board(req, conf);
  // A person's hub (hub.ts): a live socket at /hub (the token as a subprotocol, see socketToken), or one op at POST /api/hub with the token as a bearer.
  // The token is the proof, so the hub needs no cookie; a socket stays open after its token expires.
  if (pathname === "/hub" || pathname === "/api/hub") {
    const socket = pathname === "/hub", head = await cors(req, conf);
    if (!socket && req.method === "OPTIONS") return new Response(null, { status: 204, headers: head });
    if (!conf.HUB) return json({ error: "no hub here" }, 503, head);
    const sock = socketToken(req);
    const t = await tokenOf(req, conf, socket ? sock.token : bearerOf(req));
    if (!t) return json({ error: "send the token /api/exchange gave you" }, 401, head);
    const { app, who } = t;
    if (socket) {
      if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return json({ error: "a websocket" }, 426);
      // A page on somebody else's site can't open it with a token it lifted.
      const origin = req.headers.get("origin");
      if (origin && !onSite(app, origin, loopbackOn(conf))) return json({ error: "not from that app's site" }, 403);
      return echoProtocol(await hubOf(conf.HUB, who.id).fetch(new Request(`https://hub/socket?${new URLSearchParams(who)}`, { headers: { upgrade: "websocket" } })), sock.offered);
    }
    if (req.method !== "POST") return json({ error: "POST an op" }, 405, head);
    const op = check(Op, await req.json().catch(() => null));
    if (!op) return json({ error: "send { op: state | befriend | accept | drop | notify | clear | relink }" }, 400, head);
    const r = await hubAsk(conf.HUB, who, op);
    return json(r, "error" in r ? 400 : 200, head);
  }

  // Qollab: POST /q/party (bearer token) mints a code, good 24 hours, thirteen a minute refused per address.
  if (pathname === "/q/party") {
    const head = await cors(req, conf);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: head });
    if (req.method !== "POST") return json({ error: "POST with the token as a bearer" }, 405, head);
    if (!conf.PARTY) return json({ error: "no parties here" }, 503, head);
    const t = await tokenOf(req, conf, bearerOf(req));
    if (!t) return json({ error: "send the token /api/exchange gave you" }, 401, head);
    const ip = req.headers.get("cf-connecting-ip") ?? "local";
    for (let i = 0; i < 5; i++) {
      const code = mintCode();
      if (!mints.allow(ip, code, Date.now())) return json({ error: "too many parties just now; wait a minute" }, 429, head);
      const made = await partyOf(conf.PARTY, code).fetch(new Request(`https://party/make?${new URLSearchParams({ ...t.who, code, ...(new URL(req.url).searchParams.get("open") === "1" ? { open: "1" } : {}) })}`));
      if (made.ok) return json({ code, expires: Date.now() + PARTY_LIFE }, 200, head);
    }
    return json({ error: "couldn't mint a code; try again" }, 503, head);
  }

  // A party (party.ts, Qollab): a live socket at /q/party/<code>, the token as a subprotocol. The token's own app is the party's; another app's is refused.
  const party = /^\/q\/party\/([^/]+)$/.exec(pathname);
  if (party) {
    if (!conf.PARTY) return json({ error: "no parties here" }, 503);
    const code = codeOf(party[1]!);
    if (!code) return json({ error: "that isn't a party code" }, 400);
    const sock = socketToken(req);
    const t = await tokenOf(req, conf, sock.token);
    if (!t) return json({ error: "send the token /api/exchange gave you" }, 401);
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return json({ error: "a websocket" }, 426);
    const origin = req.headers.get("origin");
    if (origin && !onSite(t.app, origin, loopbackOn(conf))) return json({ error: "not from that app's site" }, 403);
    if (!tryCode(req, t.who.id, code)) return json({ error: "too many party codes just now; wait a minute" }, 429);
    // Remember the seat so deleting the account can clear it (members.ts); seats older than the longest a party lives are pruned here.
    const now = Date.now();
    await conf.DB.batch([
      conf.DB.prepare("DELETE FROM party_seats WHERE at < ?").bind(now - PARTY_LIFE_MAX),
      conf.DB.prepare("INSERT INTO party_seats (user_id, code, at) VALUES (?, ?, ?) ON CONFLICT (user_id, code) DO UPDATE SET at = excluded.at").bind(t.who.id, code, now),
    ]);
    // The invite key a party link carried (?invite=), for a party where only the host invites.
    const invite = new URL(req.url).searchParams.get("invite")?.match(/^[\w-]{1,64}$/)?.[0];
    return echoProtocol(await partyOf(conf.PARTY, code).fetch(new Request(`https://party/socket?${new URLSearchParams({ ...t.who, code, iss: issuer(req, conf), ...(invite && { invite }) })}`, { headers: { upgrade: "websocket" } })), sock.offered);
  }

  // Qollab spaces (space.ts): GET /q/space lists yours, POST { name } makes one (with { studio }, the studio's own space, its owner or admin asks),
  // POST /q/space/join { invite } joins one, and /q/space/<id> is a member's socket (the token as a subprotocol). A space is the person's, not an app's:
  // a token from any Q app opens it. A studio's space has no invite to hand out: its members are the studio's.
  if (pathname === "/q/space" || pathname === "/q/space/join") {
    const head = { ...await cors(req, conf), "access-control-allow-methods": "GET, POST" };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: head });
    if (!conf.SPACE) return json({ error: "no spaces here" }, 503, head);
    const t = await tokenOf(req, conf, bearerOf(req), { home: true });
    if (!t) return json({ error: "send the token /api/exchange gave you" }, 401, head);
    if (req.method === "GET" && pathname === "/q/space") {
      const { results } = await conf.DB.prepare(`SELECT s.id, s.name, s.invite, s.studio_id AS studio, ${ROLE_OF} AS role
        FROM spaces s LEFT JOIN studio_members sm ON sm.studio_id = s.studio_id AND sm.user_id = ?1
        LEFT JOIN space_members m ON s.studio_id IS NULL AND m.space_id = s.id AND m.user_id = ?1 WHERE s.id IN (${SPACES_OF}) ORDER BY s.name`)
        .bind(t.who.id, t.who.id).all<{ id: string; name: string; invite: string; studio: string | null; role: string }>();
      // `owner`: they run it (an owner or an admin). The invite is for those who run a person's own space; a studio's has none.
      const spaces = results.map((r): SpaceRow => {
        const runs = r.role === "owner" || r.role === "admin";
        return r.studio ? { id: r.id, name: r.name, owner: runs, studio: r.studio } : { id: r.id, name: r.name, owner: runs, ...(runs ? { invite: r.invite } : {}) };
      });
      return json({ spaces }, 200, head);
    }
    if (req.method !== "POST") return json({ error: "GET your spaces or POST one" }, 405, head);
    const now = Date.now();
    if (pathname === "/q/space/join") {
      const invite = codeOf(String(check(obj({ invite: str(12) }), await req.json().catch(() => null))?.invite ?? ""));
      if (invite && !tryCode(req, t.who.id, invite)) return json({ error: "too many invites just now; wait a minute" }, 429, head);
      const s = invite && await conf.DB.prepare("SELECT id, name FROM spaces WHERE invite = ? AND studio_id IS NULL").bind(invite).first<{ id: string; name: string }>();
      if (!s) return json({ error: "no space has that invite" }, 404, head);
      if (((await conf.DB.prepare("SELECT COUNT(*) AS n FROM space_members WHERE space_id = ?").bind(s.id).first<number>("n")) ?? 0) >= SPACE_MEMBERS)
        return json({ error: `that space is full (${SPACE_MEMBERS})` }, 409, head);
      await conf.DB.prepare("INSERT INTO space_members (space_id, user_id, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(s.id, t.who.id, now).run();
      return json({ id: s.id, name: s.name }, 200, head);
    }
    const asked = check(obj({ name: SPACE_NAME, studio: opt(str(64, { min: 1 })) }), await req.json().catch(() => null)), name = asked?.name.trim();
    if (!asked || !name) return json({ error: "send { name } (1-60 characters)" }, 400, head);
    const r = await makeSpace(conf, t.who.id, name, asked.studio ?? null);
    return r.ok ? json({ id: r.id, ...(r.invite ? { invite: r.invite } : {}) }, 200, head) : json({ error: r.error }, r.status, head);
  }
  // Qlave says who is in one voice room (qlave.ts, QLAVE.md §4): signed with QLAVE_ROSTER_SECRET, passed to the room's space.
  if (pathname === "/q/qlave/roster") {
    if (req.method !== "POST") return json({ error: "POST a roster" }, 405);
    const got = await rosterIn(req, conf.QLAVE_ROSTER_SECRET);
    if ("status" in got) return json({ error: got.status === 401 ? "bad signature" : "bad roster" }, got.status);
    if (!conf.SPACE) return json({ ok: true });
    await spaceOf(conf.SPACE, got.space).fetch(new Request("https://space/roster", { method: "POST", body: JSON.stringify({ channel: got.channel, in: got.roster.in, at: got.roster.at }) }));
    return json({ ok: true });
  }
  const spaceAt = /^\/q\/space\/([0-9a-f-]{36})$/.exec(pathname);
  if (spaceAt) {
    if (!conf.SPACE) return json({ error: "no spaces here" }, 503);
    const sock = socketToken(req);
    const t = await tokenOf(req, conf, sock.token, { home: true });
    if (!t) return json({ error: "send the token /api/exchange gave you" }, 401);
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return json({ error: "a websocket" }, 426);
    const origin = req.headers.get("origin");
    if (origin && !onSite(t.app, origin, loopbackOn(conf))) return json({ error: "not from that app's site" }, 403);
    const s = await seatIn(conf, spaceAt[1]!, t.who.id);
    if (!s) return json({ error: "not a space you're in" }, 404);
    const q = new URLSearchParams({ ...t.who, sid: spaceAt[1]!, space: s.name, role: s.role, ...(s.runs ? { owner: "1" } : {}), ...(s.studio ? { studio: s.studio } : {}), iss: issuer(req, conf) });
    return echoProtocol(await spaceOf(conf.SPACE, spaceAt[1]!).fetch(new Request(`https://space/socket?${q}`, { headers: { upgrade: "websocket" } })), sock.offered);
  }

  // A space's files (space.ts): POST /q/space/<id>/file?channel=&name= with the bytes as the body posts one in that channel as a
  // message; GET /q/space/<id>/file/<file id> brings it back. The token as a bearer, from any Q app, like the socket.
  const fileAt = /^\/q\/space\/([0-9a-f-]{36})\/file(?:\/([0-9a-f-]{36}))?$/.exec(pathname);
  if (fileAt) {
    const head = { ...await cors(req, conf), "access-control-allow-methods": "GET, POST", "access-control-expose-headers": "content-disposition" };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: head });
    if (req.method !== (fileAt[2] ? "GET" : "POST")) return json({ error: fileAt[2] ? "GET a file" : "POST a file" }, 405, head);
    if (!conf.SPACE) return json({ error: "no spaces here" }, 503, head);
    const t = await tokenOf(req, conf, bearerOf(req), { home: true });
    if (!t) return json({ error: "send the token /api/exchange gave you" }, 401, head);
    if (!fileAt[2] && Number(req.headers.get("content-length")) > FILE_MAX) return json({ error: `a file is up to ${FILE_MAX / 1024 / 1024} MB` }, 413, head);
    const s = await seatIn(conf, fileAt[1]!, t.who.id);
    if (!s) return json({ error: "not a space you're in" }, 404, head);
    const u = new URL(req.url).searchParams;
    const q = new URLSearchParams({ ...t.who, sid: fileAt[1]!, space: s.name, role: s.role, ...(s.runs ? { owner: "1" } : {}), ...(s.studio ? { studio: s.studio } : {}),
      ...(fileAt[2] ? {} : { channel: u.get("channel") ?? "general", name: u.get("name") ?? "", type: req.headers.get("content-type") ?? "" }) });
    const r = await spaceOf(conf.SPACE, fileAt[1]!).fetch(new Request(`https://space/file${fileAt[2] ? `/${fileAt[2]}` : ""}?${q}`,
      fileAt[2] ? {} : { method: "POST", body: await req.arrayBuffer() }));
    const out = new Headers(r.headers);
    for (const [k, v] of Object.entries(head)) out.set(k, v);
    return new Response(r.body, { status: r.status, headers: out });
  }

  // Qollab cloud saves (saves.ts): PUT /q/save/<slot> keeps an opaque body, GET brings the newest (or ?v=<id>) back. The token's own app is the save's.
  const save = /^\/q\/save\/([^/]+)$/.exec(pathname);
  if (save) {
    const head = { ...await cors(req, conf), "access-control-allow-methods": "GET, PUT", "access-control-expose-headers": "x-save-id, x-save-at" };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: head });
    if (req.method !== "PUT" && req.method !== "GET") return json({ error: "PUT a save or GET one, with the token as a bearer" }, 405, head);
    const slot = slotOf(save[1]!);
    if (!slot) return json({ error: "a slot is 1-40 letters, digits, - or _" }, 400, head);
    const t = await tokenOf(req, conf, bearerOf(req));
    if (!t) return json({ error: "send the token /api/exchange gave you" }, 401, head);
    if (req.method === "GET") {
      const v = Number(new URL(req.url).searchParams.get("v")) || undefined;
      const found = await getSave(conf, t.who.id, t.app.id, slot, v);
      return found ? new Response(found.data, { headers: { ...head, "content-type": "application/octet-stream", "cache-control": "private, no-store", "x-save-id": String(found.id), "x-save-at": String(found.at) } })
        : json({ error: "no save there" }, 404, head);
    }
    if (Number(req.headers.get("content-length")) > MAX_BODY) return json({ error: `a save is up to ${MAX_BODY / 1024} KB` }, 413, head);
    const r = await putSave(conf, t.who.id, t.app.id, slot, new Uint8Array(await req.arrayBuffer()));
    return r.ok ? json({ ok: true, id: r.id, at: r.at, previous: r.previous }, 200, head) : json({ error: r.error }, r.status, head);
  }
  return null;
}
