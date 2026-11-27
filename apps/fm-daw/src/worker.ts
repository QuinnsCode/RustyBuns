// Cloudflare shell. A bare visit to / lands on the front door (/door.html, also /paths); /desk serves the DAW at a new
// /sesh/<name>, and routes /ws?room=<name> to a World Durable Object, the same class the desktop
// host runs in-process. Each sesh is one shared groove. Visitors are anonymous: the Worker vouches a random id,
// the way the desktop host vouches its one local user. The Lobby counts the open
// rooms (MAX_ROOMS at once) and keeps the sign-up list for when they're all taken. A sesh can
// be private: the World keeps its code (hashed) and lets in only who brings it (?code= on /ws). GET /ice hands a guitar
// call its servers: a short-lived pass to Cloudflare's TURN relay when the TURN key is set, else STUN alone.
import World, { type WorldEnv } from "../packages/desktop/world.ts";
import Lobby, { IDLE_MS } from "./lobby.ts";
import { bounceFromPath, seshFromPath, seshName } from "./sesh.ts";
import { DOOR } from "./paths.ts";
import Profile from "./profile.ts";
import { partyOwner, PARTIES_MAX } from "./party-store.ts";
import { personId } from "./chat.ts";
import { RoomMintGate } from "@rustybuns/util/limits";
import { whoIs } from "@rustybuns/util/token";
import { APP, EQOSYS } from "./account.ts";
import { browserIce, STUN, type IceReply } from "./guitar.ts";
import { privateJson } from "@rustybuns/util/http";
import Listen from "./listen.ts";
import { setFromPath } from "./dj/live-wire.ts";
export { World, Lobby, Profile, Listen };

const mintGate = new RoomMintGate();
// A few sign-ups a minute from one address (each one a new key, so the gate counts them all).
const signupGate = new RoomMintGate(3);
// Seshes one address files bounces for a minute (each a few MB in the bucket; a sesh's next bounce replaces its last).
const bounceGate = new RoomMintGate(6);
// New profiles saved a minute from one address (a profile is one person's key).
const profileGate = new RoomMintGate(10);
const KEY = /^[0-9a-f]{32,64}$/;
// Party saves a minute from one address: the builder saves a second or so after each change, so a busy minute is a few dozen.
const partyGate = new RoomMintGate(60);
// Relay passes a minute from one address: a page asks once when it opens, and again only after half a day.
const iceGate = new RoomMintGate(6);
// Listen links one address goes live on a minute (one per DJ; a few for a DJ trying tabs), and listeners it opens.
const liveGate = new RoomMintGate(3);
const earGate = new RoomMintGate(30);
/** How long a relay pass lasts. A call set up on it stays up; a page asks again before it runs out. */
export const ICE_TTL_S = 86_400;

interface Env extends WorldEnv {
  ASSETS: { fetch(r: Request): Promise<Response> };
  WORLD: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
  LOBBY: NonNullable<WorldEnv["LOBBY"]>;
  /** One per person: their name and chat layout (src/profile.ts). */
  PROFILE: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
  /** One per live set: relays the DJ's stream to its listen link (src/listen.ts). */
  LISTEN: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
  /** Bearer token for GET /signups. Unset, the list can't be read from outside. */
  SIGNUPS_TOKEN?: string;
  /** Cloudflare Realtime's TURN key: its id and API token. Unset, a call gets STUN alone. */
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
}

/** The servers a guitar call may use: a TURN pass from Cloudflare when the key is set and answers, else STUN alone. */
async function iceServers(env: Env): Promise<IceReply> {
  if (env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN) {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: ICE_TTL_S }),
    }).catch(() => null);
    const got = r?.ok ? browserIce(await r.json().catch(() => null)) : null;
    if (got) return { iceServers: got, ttl: ICE_TTL_S };
  }
  // no pass to keep: the page asks again for its next call, so a relay that comes back is used
  return { iceServers: STUN, ttl: 0 };
}

const sha = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
async function sameToken(given: string, want: string) {
  const [a, b] = await Promise.all([sha(given), sha(want)]);
  return a.every((x, i) => x === b[i]);
}

export default {
  async fetch(req: Request, env: Env) {
    const url = new URL(req.url);
    const ip = req.headers.get("CF-Connecting-IP");
    const lobby = () => env.LOBBY.get(env.LOBBY.idFromName("lobby"));
    if (url.pathname === "/ws") {
      const room = (url.searchParams.get("room") ?? "lobby").slice(0, 64);
      if (ip && !mintGate.allow(ip, room, Date.now())) return new Response("too many new rooms, try again in a minute", { status: 429, headers: { "Retry-After": "60" } });
      const headers = new Headers(req.headers);
      // signed in with eqosys (Qollab Studio): the room knows you by your eqosys id and name; anyone else is a random guest
      headers.delete("X-User-Name");
      // an event's room asks eqosys whether the event lets this guest in, with their own token (world.ts eventDoor)
      headers.delete("X-Eqosys-Token");
      if (url.searchParams.has("token")) {
        const who = await whoIs(url, { app: APP, eqosys: env.EQOSYS_URL ?? EQOSYS, fallbackName: "Someone" });
        if (who instanceof Response) return who;
        headers.set("X-User-Id", who.uid);
        headers.set("X-User-Name", who.name);
        headers.set("X-Eqosys-Token", url.searchParams.get("token") ?? "");
      } else headers.set("X-User-Id", crypto.randomUUID());
      headers.set("X-Room", room);
      headers.set("X-Room-Idle-Ms", String(IDLE_MS));
      // a private sesh's code, as the page sent it; only the World knows whether it's right
      headers.delete("X-Sesh-Code");
      const code = url.searchParams.get("code")?.slice(0, 32);
      if (code) headers.set("X-Sesh-Code", code);
      return env.WORLD.get(env.WORLD.idFromName(room)).fetch(new Request(req, { headers }));
    }
    if ((url.pathname === "/" || url.pathname === "/desk") && req.method === "GET") {
      // an old ?room= link keeps its groove under the new address
      const old = url.searchParams.get("room")?.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 64);
      // a bare visit lands on the front door (the paths); the desk lives at /desk, which hands out a new sesh
      if (!old && url.pathname === "/") return Response.redirect(new URL(DOOR, url).href, 302);
      return Response.redirect(new URL(`/sesh/${old || seshName()}`, url).href, 302);
    }
    if (url.pathname === "/paths" && req.method === "GET") return Response.redirect(new URL(DOOR, url).href, 302);
    const bounce = bounceFromPath(url.pathname);
    if (bounce) {
      // Any page may play a sesh's bounce (a DJ's decks on another site), so the read is open to every origin.
      const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "X-Bpm" };
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET" } });
      if (req.method === "PUT" && ip && !bounceGate.allow(ip, bounce, Date.now())) return new Response("try again in a minute", { status: 429, headers: { "Retry-After": "60" } });
      const headers = new Headers({ "X-Room": bounce });
      const code = url.searchParams.get("code")?.slice(0, 32);
      if (code) headers.set("X-Sesh-Code", code);
      if (ip) headers.set("CF-Connecting-IP", ip);
      const len = req.headers.get("Content-Length");
      if (len) headers.set("Content-Length", len);
      const key = url.searchParams.get("key")?.slice(0, 128);
      const to = new URL("https://world/bounce");
      if (key) to.searchParams.set("key", key);
      const bpm = url.searchParams.get("bpm");
      if (bpm) to.searchParams.set("bpm", bpm.slice(0, 16));
      const r = await env.WORLD.get(env.WORLD.idFromName(bounce)).fetch(new Request(to, { method: req.method, headers, body: req.method === "PUT" ? req.body : undefined }));
      const out = new Response(r.body, r);
      if (req.method === "GET") for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
      return out;
    }
    const set = setFromPath(url.pathname);
    if (set) {
      // the page at /listen/<id>; its socket at /listen/<id>/ws (?dj=<key> for the DJ going live)
      if (!url.pathname.endsWith("/ws")) return env.ASSETS.fetch(new Request(new URL("/listen.html", url), req));
      const dj = url.searchParams.has("dj");
      if (ip && !(dj ? liveGate : earGate).allow(ip, dj ? set : crypto.randomUUID(), Date.now())) return new Response("try again in a minute", { status: 429, headers: { "Retry-After": "60" } });
      return env.LISTEN.get(env.LISTEN.idFromName(set)).fetch(req);
    }
    if (seshFromPath(url.pathname)) return env.ASSETS.fetch(new Request(new URL("/", url), req));
    if (url.pathname === "/me" && (req.method === "GET" || req.method === "PUT")) {
      // the key stays in the browser and this request; the profile is filed under its hash
      const key = req.headers.get("X-User-Key") ?? "";
      if (!KEY.test(key)) return new Response("no key", { status: 400 });
      const id = await personId(key);
      if (req.method === "PUT" && ip && !profileGate.allow(ip, id, Date.now())) return new Response("try again in a minute", { status: 429, headers: { "Retry-After": "60" } });
      const body = req.method === "PUT" ? (await req.text()).slice(0, 4096) : undefined;
      return env.PROFILE.get(env.PROFILE.idFromName(id)).fetch(new Request("https://profile/", { method: req.method, body }));
    }
    if (url.pathname === "/parties" && (req.method === "GET" || req.method === "PUT")) {
      // your Qevent parties on your eqosys account (#5932): only with a token (a bare uid is a guest's, and a guest has none)
      if (!url.searchParams.has("token")) return new Response("sign in with eqosys", { status: 401 });
      const who = await whoIs(url, { app: APP, eqosys: env.EQOSYS_URL ?? EQOSYS, fallbackName: "Someone" });
      if (who instanceof Response) return who;
      const owner = await partyOwner(who.uid);
      if (req.method === "PUT" && ip && !partyGate.allow(ip, crypto.randomUUID(), Date.now())) return new Response("try again in a minute", { status: 429, headers: { "Retry-After": "60" } });
      const body = req.method === "PUT" ? (await req.text()).slice(0, PARTIES_MAX + 1) : undefined;
      return env.PROFILE.get(env.PROFILE.idFromName(`parties:${owner}`)).fetch(new Request("https://profile/parties", { method: req.method, body, headers: { "X-Party-Owner": owner } }));
    }
    const liveOf = /^\/party\/([0-9a-f]{24})$/.exec(url.pathname)?.[1];
    if (liveOf && req.method === "GET") {
      // the live party as its join link reads it: the scene on stage, its time and its room
      return env.PROFILE.get(env.PROFILE.idFromName(`parties:${liveOf}`)).fetch(new Request("https://profile/live", { headers: { "X-Party-Owner": liveOf } }));
    }
    if (url.pathname === "/ice" && req.method === "GET") {
      // each ask its own key, so a burst in one millisecond counts every one
      if (ip && !iceGate.allow(ip, crypto.randomUUID(), Date.now())) return new Response("try again in a minute", { status: 429, headers: { "Retry-After": "60" } });
      return privateJson(await iceServers(env));
    }
    if (url.pathname === "/rooms" && req.method === "GET") return lobby().fetch("https://lobby/status");
    if (url.pathname === "/signup" && req.method === "POST") {
      if (ip && !signupGate.allow(ip, String(Date.now()), Date.now())) return new Response("try again in a minute", { status: 429, headers: { "Retry-After": "60" } });
      return lobby().fetch("https://lobby/signup", { method: "POST", body: (await req.text()).slice(0, 4096) });
    }
    if (url.pathname === "/signups" && req.method === "GET") {
      const given = req.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
      if (!env.SIGNUPS_TOKEN || !(await sameToken(given, env.SIGNUPS_TOKEN))) return new Response("not found", { status: 404 });
      return lobby().fetch("https://lobby/signups");
    }
    return env.ASSETS.fetch(req);
  },
};
