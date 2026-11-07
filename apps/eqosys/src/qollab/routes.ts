// Qollab's paths: a person's hub (one Durable Object a player) and the rooms they meet in (a party a room code, a space a group),
// plus cloud saves and Qlave's voice roster. Every one is entered with an app's token (door.ts), never a session cookie, so this
// file and the rest of qollab/ could move to a Worker of their own with nothing else changing (QOLLAB.md).
import { onSite } from "../apps.ts";
import { json, loopbackOn, type Env } from "../env.ts";
import { bearerOf, cors, echoProtocol, issuer, socketToken, tokenOf } from "../door.ts";
import { hubAsk, hubOf, Op } from "./hub.ts";
import { codeOf, mintCode, PARTY_LIFE, partyOf } from "./party.ts";
import { SPACE_MEMBERS, SPACE_NAME, SPACES_OWNED, spaceOf } from "./space.ts";
import { rosterIn } from "./qlave.ts";
import { get as getSave, MAX_BODY, put as putSave, slotOf } from "./saves.ts";
import type { SpaceRow } from "@rustybuns/util/eqosys";
import { RoomMintGate } from "@rustybuns/util/limits";
import { check, obj, str } from "@rustybuns/util/guard";

const mints = new RoomMintGate(12, 60_000);

/** The paths below, the ones eqosys hands to Qollab's own Worker. `/q/achieve` is eqosys's (achievements). */
export const isQollab = (pathname: string) =>
  /^\/(?:hub|api\/hub|q\/party(?:\/[^/]+)?|q\/space(?:\/[^/]+)?|q\/qlave\/roster|q\/save\/[^/]+)$/.test(pathname);

/** A Qollab path's answer, or null when the path isn't Qollab's. */
export async function qollab(req: Request, conf: Env): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  // A person's hub (hub.ts): a live socket at /hub (the token as a subprotocol, see socketToken), or one op at POST /api/hub with the token as a bearer.
  // The token is the proof, so the hub needs no cookie; a socket stays open after its token expires.
  if (pathname === "/hub" || pathname === "/api/hub") {
    const socket = pathname === "/hub", head = cors(req, conf);
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
    if (!op) return json({ error: "send { op: state | befriend | accept | drop | notify | clear }" }, 400, head);
    const r = await hubAsk(conf.HUB, who, op);
    return json(r, "error" in r ? 400 : 200, head);
  }

  // Qollab: POST /q/party (bearer token) mints a code, good 24 hours, thirteen a minute refused per address.
  if (pathname === "/q/party") {
    const head = cors(req, conf);
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
    // Remember the seat so deleting the account can clear it (members.ts); seats older than a party lives are pruned here.
    const now = Date.now();
    await conf.DB.batch([
      conf.DB.prepare("DELETE FROM party_seats WHERE at < ?").bind(now - PARTY_LIFE),
      conf.DB.prepare("INSERT INTO party_seats (user_id, code, at) VALUES (?, ?, ?) ON CONFLICT (user_id, code) DO UPDATE SET at = excluded.at").bind(t.who.id, code, now),
    ]);
    return echoProtocol(await partyOf(conf.PARTY, code).fetch(new Request(`https://party/socket?${new URLSearchParams({ ...t.who, code, iss: issuer(req, conf) })}`, { headers: { upgrade: "websocket" } })), sock.offered);
  }

  // Qollab spaces (space.ts): GET /q/space lists yours, POST { name } makes one, POST /q/space/join { invite } joins one,
  // and /q/space/<id> is a member's socket (the token as a subprotocol). A space is the person's, not an app's: a token from any Q app opens it.
  if (pathname === "/q/space" || pathname === "/q/space/join") {
    const head = { ...cors(req, conf), "access-control-allow-methods": "GET, POST" };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: head });
    if (!conf.SPACE) return json({ error: "no spaces here" }, 503, head);
    const t = await tokenOf(req, conf, bearerOf(req));
    if (!t) return json({ error: "send the token /api/exchange gave you" }, 401, head);
    if (req.method === "GET" && pathname === "/q/space") {
      const { results } = await conf.DB.prepare("SELECT s.id, s.name, s.owner, s.invite FROM space_members m JOIN spaces s ON s.id = m.space_id WHERE m.user_id = ? ORDER BY s.name")
        .bind(t.who.id).all<{ id: string; name: string; owner: string; invite: string }>();
      const spaces = results.map((r): SpaceRow => ({ id: r.id, name: r.name, owner: r.owner === t.who.id, ...(r.owner === t.who.id ? { invite: r.invite } : {}) }));
      return json({ spaces }, 200, head);
    }
    if (req.method !== "POST") return json({ error: "GET your spaces or POST one" }, 405, head);
    const now = Date.now();
    if (pathname === "/q/space/join") {
      const invite = codeOf(String(check(obj({ invite: str(12) }), await req.json().catch(() => null))?.invite ?? ""));
      const s = invite && await conf.DB.prepare("SELECT id, name FROM spaces WHERE invite = ?").bind(invite).first<{ id: string; name: string }>();
      if (!s) return json({ error: "no space has that invite" }, 404, head);
      if (((await conf.DB.prepare("SELECT COUNT(*) AS n FROM space_members WHERE space_id = ?").bind(s.id).first<number>("n")) ?? 0) >= SPACE_MEMBERS)
        return json({ error: `that space is full (${SPACE_MEMBERS})` }, 409, head);
      await conf.DB.prepare("INSERT INTO space_members (space_id, user_id, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(s.id, t.who.id, now).run();
      return json({ id: s.id, name: s.name }, 200, head);
    }
    const name = check(obj({ name: SPACE_NAME }), await req.json().catch(() => null))?.name.trim();
    if (!name) return json({ error: "send { name } (1-60 characters)" }, 400, head);
    if (((await conf.DB.prepare("SELECT COUNT(*) AS n FROM spaces WHERE owner = ?").bind(t.who.id).first<number>("n")) ?? 0) >= SPACES_OWNED)
      return json({ error: `you own ${SPACES_OWNED} spaces already` }, 409, head);
    const id = crypto.randomUUID();
    for (let i = 0; i < 5; i++) {
      const invite = mintCode();
      const made = await conf.DB.prepare("INSERT INTO spaces (id, name, owner, invite, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id").bind(id, name, t.who.id, invite, now).first<string>("id");
      if (!made) continue;
      await conf.DB.prepare("INSERT INTO space_members (space_id, user_id, at) VALUES (?, ?, ?)").bind(id, t.who.id, now).run();
      return json({ id, invite }, 200, head);
    }
    return json({ error: "couldn't mint an invite; try again" }, 503, head);
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
    const t = await tokenOf(req, conf, sock.token);
    if (!t) return json({ error: "send the token /api/exchange gave you" }, 401);
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return json({ error: "a websocket" }, 426);
    const origin = req.headers.get("origin");
    if (origin && !onSite(t.app, origin, loopbackOn(conf))) return json({ error: "not from that app's site" }, 403);
    const s = await conf.DB.prepare("SELECT s.name, s.owner FROM space_members m JOIN spaces s ON s.id = m.space_id WHERE m.space_id = ? AND m.user_id = ?")
      .bind(spaceAt[1], t.who.id).first<{ name: string; owner: string }>();
    if (!s) return json({ error: "not a space you're in" }, 404);
    const q = new URLSearchParams({ ...t.who, sid: spaceAt[1]!, space: s.name, ...(s.owner === t.who.id ? { owner: "1" } : {}), iss: issuer(req, conf) });
    return echoProtocol(await spaceOf(conf.SPACE, spaceAt[1]!).fetch(new Request(`https://space/socket?${q}`, { headers: { upgrade: "websocket" } })), sock.offered);
  }

  // Qollab cloud saves (saves.ts): PUT /q/save/<slot> keeps an opaque body, GET brings the newest (or ?v=<id>) back. The token's own app is the save's.
  const save = /^\/q\/save\/([^/]+)$/.exec(pathname);
  if (save) {
    const head = { ...cors(req, conf), "access-control-allow-methods": "GET, PUT", "access-control-expose-headers": "x-save-id, x-save-at" };
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
