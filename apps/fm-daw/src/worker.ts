// Cloudflare shell. Serves the page at /sesh/<name> (a bare visit gets a new name),
// and routes /ws?room=<name> to a World Durable Object, the same class the desktop
// host runs in-process. Each sesh is one shared groove. Visitors are anonymous: the Worker vouches a random id,
// the way the desktop host vouches its one local user. The Lobby counts the open
// rooms (MAX_ROOMS at once) and keeps the sign-up list for when they're all taken. A sesh can
// be private: the World keeps its code (hashed) and lets in only who brings it (?code= on /ws).
import World, { type WorldEnv } from "../packages/desktop/world.ts";
import Lobby, { IDLE_MS } from "./lobby.ts";
import { bounceFromPath, seshFromPath, seshName } from "./sesh.ts";
import Profile from "./profile.ts";
import { personId } from "./chat.ts";
import { RoomMintGate } from "@rustybuns/util/limits";
import { whoIs } from "@rustybuns/util/token";
import { APP, EQOSYS } from "./account.ts";
export { World, Lobby, Profile };

const mintGate = new RoomMintGate();
// A few sign-ups a minute from one address (each one a new key, so the gate counts them all).
const signupGate = new RoomMintGate(3);
// Seshes one address files bounces for a minute (each a few MB in the bucket; a sesh's next bounce replaces its last).
const bounceGate = new RoomMintGate(6);
// New profiles saved a minute from one address (a profile is one person's key).
const profileGate = new RoomMintGate(10);
const KEY = /^[0-9a-f]{32,64}$/;

interface Env extends WorldEnv {
  ASSETS: { fetch(r: Request): Promise<Response> };
  WORLD: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
  LOBBY: NonNullable<WorldEnv["LOBBY"]>;
  /** One per person: their name and chat layout (src/profile.ts). */
  PROFILE: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
  /** Where eqosys is (a test's or a local one); unset, the live one. */
  EQOSYS_URL?: string;
  /** Bearer token for GET /signups. Unset, the list can't be read from outside. */
  SIGNUPS_TOKEN?: string;
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
      if (url.searchParams.has("token")) {
        const who = await whoIs(url, { app: APP, eqosys: env.EQOSYS_URL ?? EQOSYS, fallbackName: "Someone" });
        if (who instanceof Response) return who;
        headers.set("X-User-Id", who.uid);
        headers.set("X-User-Name", who.name);
      } else headers.set("X-User-Id", crypto.randomUUID());
      headers.set("X-Room", room);
      headers.set("X-Room-Idle-Ms", String(IDLE_MS));
      // a private sesh's code, as the page sent it; only the World knows whether it's right
      headers.delete("X-Sesh-Code");
      const code = url.searchParams.get("code")?.slice(0, 32);
      if (code) headers.set("X-Sesh-Code", code);
      return env.WORLD.get(env.WORLD.idFromName(room)).fetch(new Request(req, { headers }));
    }
    if (url.pathname === "/" && req.method === "GET") {
      // an old ?room= link keeps its groove under the new address
      const old = url.searchParams.get("room")?.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 64);
      return Response.redirect(new URL(`/sesh/${old || seshName()}`, url).href, 302);
    }
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
